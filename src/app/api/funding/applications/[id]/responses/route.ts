import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";

const FUNDING_FEATURE_KEY = "funding";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/funding/applications/[id]/responses
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  if (!(await isFeatureEnabled(tenantId, FUNDING_FEATURE_KEY))) {
    return jsonError("Funding feature is not enabled", 403);
  }
  const permErr = await assertPermissionOrFail(session, tenantId, Permission.funding_view);
  if (permErr) return permErr;

  const app = await prisma.fundingApplication.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  if (!app) return jsonError("Application not found", 404);

  const responses = await prisma.fundingResponse.findMany({
    where: { applicationId: id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(responses);
}

/**
 * POST /api/funding/applications/[id]/responses
 * Add a response to an application.
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

  const app = await prisma.fundingApplication.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  if (!app) return jsonError("Application not found", 404);

  let body: { questionId?: string; questionLabel?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  // Must supply either a questionId (linked to opportunity) or a freeform questionLabel
  if (!body.questionId && (!body.questionLabel || typeof body.questionLabel !== "string")) {
    return jsonError("questionId or questionLabel required");
  }

  let label = body.questionLabel ?? "";
  if (body.questionId) {
    const question = await prisma.fundingQuestion.findUnique({
      where: { id: body.questionId },
    });
    if (!question) return jsonError("Question not found", 404);
    label = question.label;
  }

  const response = await prisma.fundingResponse.create({
    data: {
      applicationId: id,
      questionId: body.questionId ?? null,
      questionLabel: label,
      content: body.content ?? "",
      source: "MANUAL",
    },
  });
  return NextResponse.json(response, { status: 201 });
}
