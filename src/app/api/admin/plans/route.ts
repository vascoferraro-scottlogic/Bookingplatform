import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertRoleOrFail, rejectIfImpersonating, jsonError } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";

/** List all plans (including inactive) — PLATFORM_ADMIN only. */
export async function GET() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;

  const plans = await prisma.platformPlan.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(plans);
}

/** Create a new plan — PLATFORM_ADMIN only. */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const body = await req.json().catch(() => null);
  if (!body) return jsonError("Invalid JSON");

  const { name, slug, description, priceMonthlyPence, trialDays, maxMembers, maxGreens, includedStreamingTier, featureFlags, sortOrder } = body;

  if (!name || !slug || priceMonthlyPence == null) {
    return jsonError("name, slug, and priceMonthlyPence are required");
  }

  // Check slug uniqueness
  const existing = await prisma.platformPlan.findUnique({ where: { slug } });
  if (existing) return jsonError("A plan with this slug already exists", 409);

  const plan = await prisma.platformPlan.create({
    data: {
      name,
      slug,
      description: description ?? null,
      priceMonthlyPence,
      trialDays: trialDays ?? 30,
      maxMembers: maxMembers ?? 50,
      maxGreens: maxGreens ?? 2,
      includedStreamingTier: includedStreamingTier ?? "NONE",
      featureFlags: featureFlags ?? {},
      sortOrder: sortOrder ?? 0,
      active: true,
    },
  });

  logAudit({ session, action: "billing.plan.created", entity: "PlatformPlan", entityId: plan.id, meta: { name, slug, priceMonthlyPence } });

  return NextResponse.json(plan, { status: 201 });
}
