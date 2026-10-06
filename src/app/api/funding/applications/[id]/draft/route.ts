import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";
import { getAgent } from "@/lib/agent/registry";

const FUNDING_FEATURE_KEY = "funding";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/funding/applications/[id]/draft
 * Trigger AI draft generation for this application's unanswered questions.
 * Runs the funding-app agent for the tenant and returns the run summary.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  if (!(await isFeatureEnabled(tenantId, FUNDING_FEATURE_KEY))) {
    return jsonError("Funding feature is not enabled", 403);
  }
  const permErr = await assertPermissionOrFail(session, tenantId, Permission.funding_manage);
  if (permErr) return permErr;

  // Verify the application exists, belongs to the tenant, and is in DRAFT status.
  const app = await prisma.fundingApplication.findFirst({
    where: { id, tenantId },
    select: { id: true, status: true },
  });
  if (!app) return jsonError("Application not found", 404);
  if (app.status !== "DRAFT") {
    return jsonError("Can only generate drafts for DRAFT applications", 400);
  }

  const agent = getAgent("funding-app");
  if (!agent) {
    return jsonError("Funding agent not configured", 500);
  }

  const run = await agent.runForTenant(tenantId);
  return NextResponse.json({
    runId: run.id,
    status: run.status,
    summary: run.summary ? JSON.parse(run.summary) : null,
  });
}
