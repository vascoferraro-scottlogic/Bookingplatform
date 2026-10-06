import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";

const FUNDING_FEATURE_KEY = "funding";

/**
 * GET /api/funding/status — non-noisy gate check for the sidebar.
 * Always 200 so the nav can hide/show the link without swallowing 403s.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const flagEnabled = await isFeatureEnabled(tenantId, FUNDING_FEATURE_KEY);

  return NextResponse.json({ flagEnabled, available: flagEnabled });
}
