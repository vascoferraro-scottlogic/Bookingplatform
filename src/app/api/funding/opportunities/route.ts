import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";
import { assertPermissionOrFail } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { rankOpportunities } from "@/lib/funding/eligibility";

const FUNDING_FEATURE_KEY = "funding";

/**
 * GET /api/funding/opportunities?tag=...&active=true
 * Returns platform-level opportunities (tenantId IS NULL) plus
 * the caller's own tenant-created opportunities.
 * Each opportunity includes an eligibility score and reasons.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  if (!(await isFeatureEnabled(tenantId, FUNDING_FEATURE_KEY))) {
    return jsonError("Funding feature is not enabled", 403);
  }
  const permErr = await assertPermissionOrFail(session, "funding_view");
  if (permErr) return permErr;

  const url = new URL(req.url);
  const tag = url.searchParams.get("tag");
  const activeOnly = url.searchParams.get("active") !== "false";

  const [opportunities, tenant, tenantApps, tenantPrefs] = await Promise.all([
    prisma.fundingOpportunity.findMany({
      where: {
        OR: [{ tenantId: null }, { tenantId }],
        ...(activeOnly ? { active: true } : {}),
        ...(tag ? { tags: { has: tag } } : {}),
      },
      include: {
        questions: { orderBy: { sortOrder: "asc" } },
        _count: { select: { applications: true } },
      },
      orderBy: [{ deadline: "asc" }, { name: "asc" }],
    }),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { country: true, organisationType: true },
    }),
    // All applications by this tenant across all opportunities
    prisma.fundingApplication.findMany({
      where: { tenantId },
      select: {
        id: true,
        opportunityId: true,
        status: true,
        submittedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    // Tenant's custom re-apply interval overrides
    prisma.fundingOpportunityPref.findMany({
      where: { tenantId },
      select: { opportunityId: true, reapplyIntervalMonths: true },
    }),
  ]);

  const profile = {
    country: tenant?.country ?? "OTHER",
    organisationType: tenant?.organisationType ?? null,
  };
  const scores = rankOpportunities(opportunities, profile);
  const scoreMap = new Map(scores.map((s) => [s.opportunityId, s]));

  // Build per-opportunity application summary for this tenant
  const TERMINAL_STATUSES = ["APPROVED", "REJECTED", "WITHDRAWN"] as const;
  type AppStatus = typeof tenantApps[number]["status"];

  const appsByOpp = new Map<string, typeof tenantApps>();
  for (const app of tenantApps) {
    const list = appsByOpp.get(app.opportunityId) ?? [];
    list.push(app);
    appsByOpp.set(app.opportunityId, list);
  }
  const prefMap = new Map(tenantPrefs.map((p) => [p.opportunityId, p.reapplyIntervalMonths]));

  // Attach score, application summary, and cadence to each opportunity and sort by score desc
  const scored = opportunities.map((opp) => {
    const apps = appsByOpp.get(opp.id) ?? [];
    // Latest app = highest createdAt
    const latestApp = apps.length > 0 ? apps[apps.length - 1] : null;
    const latestStatus: AppStatus | null = latestApp?.status ?? null;
    const isActive = latestApp && !TERMINAL_STATUSES.includes(latestApp.status as typeof TERMINAL_STATUSES[number]);
    const lastSubmittedAt = latestApp?.submittedAt ?? null;

    // Effective cadence: stricter (longer) of funder cadence and tenant override
    const funderInterval = opp.reapplyIntervalMonths ?? null;
    const tenantInterval = prefMap.get(opp.id) ?? null;
    const effectiveInterval =
      funderInterval !== null && tenantInterval !== null
        ? Math.max(funderInterval, tenantInterval)
        : funderInterval ?? tenantInterval ?? null;

    // Advisory warning: months since last application vs effective interval
    let cadenceWarningMonths: number | null = null;
    if (effectiveInterval !== null && lastSubmittedAt) {
      const monthsSince =
        (Date.now() - new Date(lastSubmittedAt).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
      if (monthsSince < effectiveInterval) {
        cadenceWarningMonths = Math.ceil(effectiveInterval - monthsSince);
      }
    }

    return {
      ...opp,
      eligibility: scoreMap.get(opp.id) ?? { score: 0, reasons: ["Not eligible"] },
      tenantApplications: {
        count: apps.length,
        latestStatus,
        latestApplicationId: latestApp?.id ?? null,
        lastSubmittedAt,
        isActive: !!isActive,
        canApply: !isActive,
      },
      cadence: {
        funderIntervalMonths: funderInterval,
        tenantIntervalMonths: tenantInterval,
        effectiveIntervalMonths: effectiveInterval,
        warningMonthsRemaining: cadenceWarningMonths,
      },
    };
  });
  scored.sort((a, b) => b.eligibility.score - a.eligibility.score);

  return NextResponse.json(scored);
}

/**
 * POST /api/funding/opportunities
 * Create a tenant-owned opportunity (club found their own grant).
 */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  if (!(await isFeatureEnabled(tenantId, FUNDING_FEATURE_KEY))) {
    return jsonError("Funding feature is not enabled", 403);
  }
  const permErr = await assertPermissionOrFail(session, "funding_manage");
  if (permErr) return permErr;

  let body: {
    name?: string;
    funder?: string;
    description?: string;
    url?: string;
    eligibilityNotes?: string;
    deadline?: string;
    maxAmount?: number;
    minAmount?: number;
    tags?: string[];
    questions?: { label: string; helpText?: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  if (!body.name || typeof body.name !== "string") return jsonError("name required");
  if (!body.funder || typeof body.funder !== "string") return jsonError("funder required");
  if (!body.description || typeof body.description !== "string") return jsonError("description required");

  const opportunity = await prisma.fundingOpportunity.create({
    data: {
      tenantId,
      name: body.name,
      funder: body.funder,
      description: body.description,
      url: body.url ?? null,
      eligibilityNotes: body.eligibilityNotes ?? null,
      deadline: body.deadline ? new Date(body.deadline) : null,
      maxAmount: body.maxAmount ?? null,
      minAmount: body.minAmount ?? null,
      tags: body.tags ?? [],
      questions: body.questions?.length
        ? {
            create: body.questions.map((q, i) => ({
              label: q.label,
              helpText: q.helpText ?? null,
              sortOrder: i,
            })),
          }
        : undefined,
    },
    include: { questions: { orderBy: { sortOrder: "asc" } } },
  });

  logAudit({
    session,
    action: "funding.opportunity.created",
    entity: "FundingOpportunity",
    entityId: opportunity.id,
    tenantId,
    meta: { name: body.name, funder: body.funder },
  });

  return NextResponse.json(opportunity, { status: 201 });
}
