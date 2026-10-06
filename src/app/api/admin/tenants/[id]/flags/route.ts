import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, getEffective, jsonError, rejectIfImpersonating, type AppSession } from "@/lib/api-utils";
import { setFeatureFlag, getTenantFlags } from "@/lib/features";
import { TENANT_TOGGLABLE_FLAGS } from "@/lib/flags/keys";
import { logAudit } from "@/lib/audit";

// The set a TENANT_ADMIN may flip on their own tenant via the onboarding wizard /
// settings UI is exactly the canonical TENANT_TOGGLABLE taxonomy in
// `@/lib/flags/keys` — imported here so this gate can't drift from it.
//
// Everything else stays PLATFORM_ADMIN-only:
//   - capability/preset flags (category 2: bookings/agent/funding/charity/…) are
//     provisioned per-tenant by the onboarding vertical preset + plan tier, not
//     self-served. `agent`, for instance, is vertical-conditional since
//     #modular-services — it's platform-controlled state, not a tenant toggle.
//   - platform rollout flags (category 3) are targeted via the Unleash UI.
const TENANT_TOGGLABLE = new Set<string>(TENANT_TOGGLABLE_FLAGS);

function gateFor(session: AppSession, tenantId: string, key: string | null): NextResponse | null {
  const eff = getEffective(session);
  const isPlatformAdmin = session.user.role === "PLATFORM_ADMIN" && !eff.isImpersonating;
  if (isPlatformAdmin) {
    return rejectIfImpersonating(session);
  }
  if ((eff.role === "TENANT_ADMIN" || eff.role === "PLATFORM_ADMIN") && eff.tenantId === tenantId) {
    if (key !== null && !TENANT_TOGGLABLE.has(key)) {
      return jsonError("This flag is platform-controlled.", 403);
    }
    return null;
  }
  return jsonError("Forbidden", 403);
}

/** List feature flags for a tenant. PLATFORM_ADMIN any; TENANT_ADMIN own. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const gateErr = gateFor(session, id, null);
  if (gateErr) return gateErr;

  const flags = await getTenantFlags(id);
  return NextResponse.json(flags);
}

/** Set a feature flag for a tenant. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const { key, enabled } = await req.json();
  if (!key || typeof enabled !== "boolean") {
    return jsonError("key (string) and enabled (boolean) required");
  }

  const gateErr = gateFor(session, id, key);
  if (gateErr) return gateErr;

  const flag = await setFeatureFlag(id, key, enabled);

  logAudit({ session, action: "admin.feature_flag.toggled", entity: "FeatureFlag", entityId: flag.id, tenantId: id, meta: { key, enabled } });

  return NextResponse.json(flag);
}
