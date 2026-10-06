import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";

const FUNDING_FEATURE_KEY = "funding";

type RouteParams = { params: Promise<{ id: string; responseId: string }> };

/**
 * PATCH /api/funding/applications/[id]/responses/[responseId]
 * Update a response's content.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id, responseId } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  if (!(await isFeatureEnabled(tenantId, FUNDING_FEATURE_KEY))) {
    return jsonError("Funding feature is not enabled", 403);
  }
  const permErr = await assertPermissionOrFail(session, tenantId, Permission.funding_manage);
  if (permErr) return permErr;

  let body: { content?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  if (typeof body.content !== "string") {
    return jsonError("Content is required", 400);
  }

  // Ensure the response belongs to the application and tenant
  const response = await prisma.fundingResponse.findFirst({
    where: {
      id: responseId,
      applicationId: id,
      application: { tenantId },
    },
  });
  if (!response) return jsonError("Response not found", 404);

  const updated = await prisma.fundingResponse.update({
    where: { id: responseId },
    data: { content: body.content },
  });
  return NextResponse.json(updated);
}
