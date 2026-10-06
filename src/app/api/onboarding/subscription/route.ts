import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";

/**
 * GET /api/onboarding/subscription
 *
 * Returns whether the current tenant has self-attested they'll pay,
 * plus the selected planId if a billing profile exists.
 */
export async function GET(_req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const tenantId = getEffective(session).tenantId;
  if (!tenantId) return jsonError("No tenant context", 400);

  const [progress, profile] = await Promise.all([
    prisma.onboardingProgress.findUnique({
      where: { tenantId },
      select: { subscriptionAttestedAt: true },
    }),
    prisma.tenantBillingProfile.findUnique({
      where: { tenantId },
      select: { planId: true },
    }),
  ]);

  return NextResponse.json({
    attested: !!progress?.subscriptionAttestedAt,
    attestedAt: progress?.subscriptionAttestedAt ?? null,
    planId: profile?.planId ?? null,
  });
}

/**
 * POST /api/onboarding/subscription
 *
 * Self-attests that the tenant admin will pay. Accepts optional { planId }
 * to select a platform plan. Creates a TenantBillingProfile in TRIAL status.
 * Defaults to the first active plan (by sortOrder) if no planId provided.
 * Idempotent: re-attesting is a no-op.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const tenantId = getEffective(session).tenantId;
  if (!tenantId) return jsonError("No tenant context", 400);

  const existing = await prisma.onboardingProgress.findUnique({
    where: { tenantId },
    select: { id: true, subscriptionAttestedAt: true },
  });

  if (existing?.subscriptionAttestedAt) {
    return NextResponse.json({
      attested: true,
      attestedAt: existing.subscriptionAttestedAt,
      unchanged: true,
    });
  }

  // Resolve plan
  const body = await req.json().catch(() => ({}));
  let planId = (body as { planId?: string }).planId ?? null;

  if (planId) {
    const plan = await prisma.platformPlan.findUnique({ where: { id: planId }, select: { id: true, active: true } });
    if (!plan || !plan.active) return jsonError("Invalid or inactive plan", 400);
  } else {
    // Default to cheapest active plan
    const defaultPlan = await prisma.platformPlan.findFirst({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true } });
    planId = defaultPlan?.id ?? null;
  }

  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setDate(trialEnd.getDate() + 30);
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  // Create attestation + billing profile in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const progress = existing
      ? await tx.onboardingProgress.update({
          where: { tenantId },
          data: { subscriptionAttestedAt: now },
          select: { id: true, subscriptionAttestedAt: true },
        })
      : await tx.onboardingProgress.create({
          data: { tenantId, subscriptionAttestedAt: now },
          select: { id: true, subscriptionAttestedAt: true },
        });

    // Create billing profile if plan available and profile doesn't exist yet
    if (planId) {
      const existingProfile = await tx.tenantBillingProfile.findUnique({ where: { tenantId } });
      if (!existingProfile) {
        await tx.tenantBillingProfile.create({
          data: {
            tenantId,
            planId,
            billingStatus: "TRIAL",
            paymentMethod: "INVOICE",
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            trialEndsAt: trialEnd,
          },
        });
      }
    }

    return progress;
  });

  logAudit({
    session,
    action: "onboarding.subscription.attested",
    entity: "OnboardingProgress",
    entityId: result.id,
    tenantId,
    meta: { planId },
  });

  return NextResponse.json({ attested: true, attestedAt: result.subscriptionAttestedAt });
}
