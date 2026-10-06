import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";
import { assertPermissionOrFail } from "@/lib/permissions";

const FUNDING_FEATURE_KEY = "funding";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * PATCH /api/funding/opportunities/[id]/pref
 * Upsert a tenant's custom re-apply interval override for an opportunity.
 * Body: { reapplyIntervalMonths: number | null }
 * Passing null clears the override.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id: opportunityId } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  if (!(await isFeatureEnabled(tenantId, FUNDING_FEATURE_KEY))) {
    return jsonError("Funding feature is not enabled", 403);
  }
  const permErr = await assertPermissionOrFail(session, "funding_manage");
  if (permErr) return permErr;

  let body: { reapplyIntervalMonths?: number | null };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  const { reapplyIntervalMonths } = body;

  if (reapplyIntervalMonths !== null && reapplyIntervalMonths !== undefined) {
    if (!Number.isInteger(reapplyIntervalMonths) || reapplyIntervalMonths < 1) {
      return jsonError("reapplyIntervalMonths must be a positive integer or null");
    }
  }

  // Confirm the opportunity exists and is accessible to this tenant
  const opportunity = await prisma.fundingOpportunity.findFirst({
    where: {
      id: opportunityId,
      OR: [{ tenantId: null }, { tenantId }],
    },
    select: { id: true, reapplyIntervalMonths: true },
  });
  if (!opportunity) return jsonError("Opportunity not found", 404);

  const pref = await prisma.fundingOpportunityPref.upsert({
    where: { tenantId_opportunityId: { tenantId, opportunityId } },
    create: { tenantId, opportunityId, reapplyIntervalMonths: reapplyIntervalMonths ?? null },
    update: { reapplyIntervalMonths: reapplyIntervalMonths ?? null },
  });

  return NextResponse.json(pref);
}
