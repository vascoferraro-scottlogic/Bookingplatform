import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail } from "@/lib/api-utils";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";
import {
  CHARITY_FEATURE_KEY,
  CHARITY_SUPPORTED_COUNTRIES,
} from "@/lib/charity/feature-gate";

/**
 * GET /api/charity/status — non-noisy gate check for the UI sidebar
 * and dashboard. Returns the country, flag state, supported flag, and
 * whether settings are configured. Always 200 so the nav-rendering code
 * doesn't have to swallow 403s.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  const permErr = await assertPermissionOrFail(session, tenantId, Permission.charity_view);
  if (permErr) return permErr;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { country: true },
  });
  const country = tenant?.country ?? "OTHER";
  const supportedCountry = CHARITY_SUPPORTED_COUNTRIES.includes(country);
  const flagEnabled = await isFeatureEnabled(tenantId, CHARITY_FEATURE_KEY);

  let configured = false;
  if (supportedCountry && flagEnabled) {
    configured = !!(await prisma.charitySettings.findUnique({ where: { tenantId } }));
  }

  return NextResponse.json({
    country,
    supportedCountry,
    flagEnabled,
    available: supportedCountry && flagEnabled,
    configured,
    supportedCountries: CHARITY_SUPPORTED_COUNTRIES,
  });
}
