import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { getTenantFlags, evaluatePlatformFlags } from "@/lib/features";
import { PLATFORM_FLAGS } from "@/lib/flags/keys";

/** Return the current tenant's feature flags as `{ key: enabled, ... }`.
 *  Used by the dashboard layout (and any client) to decide whether to render
 *  feature-gated nav links / UI without firing a request to each feature's
 *  list endpoint and inferring from the response shape.
 *
 *  Postgres-owned keys (tenant-togglable + capability/preset) come straight from
 *  the tenant's rows; PLATFORM keys (#feature-management category 3) are evaluated
 *  through the router with the caller's session context, so post-cutover the nav
 *  reflects Unleash targeting (and falls back to Postgres when Unleash is
 *  unconfigured). */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const flags = await getTenantFlags(tenantId);
  const map: Record<string, boolean> = {};
  for (const f of flags) map[f.key] = f.enabled;

  const platform = await evaluatePlatformFlags(session, req, PLATFORM_FLAGS);
  Object.assign(map, platform);

  return NextResponse.json(map);
}
