import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { hasRole } from "@/lib/roles";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { getTenantSubscription, upsertSubscription, TIER_CONFIG } from "@/lib/streaming";
import { StreamingTier } from "@prisma/client";

const VALID_TIERS: StreamingTier[] = ["NONE", "BRONZE", "SILVER", "GOLD"];

/** GET — get current streaming subscription for tenant. */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!hasRole(session.user.role, "TENANT_ADMIN")) {
    return jsonError("Forbidden", 403);
  }

  const sub = await getTenantSubscription(tenantId);

  return NextResponse.json({
    subscription: sub ?? { tier: "NONE", maxConcurrentStreams: 0, archiveRetentionDays: 0, priceMonthlyPence: 0 },
    availableTiers: TIER_CONFIG,
  });
}

/** PATCH — change streaming tier. TENANT_ADMIN+ only. */
export async function PATCH(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!hasRole(session.user.role, "TENANT_ADMIN")) {
    return jsonError("Forbidden", 403);
  }

  const body = await req.json();
  const { tier } = body;

  if (!tier || !VALID_TIERS.includes(tier)) {
    return jsonError(`Invalid tier. Must be one of: ${VALID_TIERS.join(", ")}`);
  }

  const subscription = await upsertSubscription(tenantId, tier);

  logAudit({
    session,
    action: "streaming.tier_changed",
    entity: "TenantSubscription",
    entityId: subscription.id,
    meta: { tier },
  });

  return NextResponse.json(subscription);
}
