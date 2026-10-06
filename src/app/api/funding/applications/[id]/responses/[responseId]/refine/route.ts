import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";
import { aggregateTenantContext, refineAnswer } from "@/lib/funding/ai";

const FUNDING_FEATURE_KEY = "funding";
const MAX_INSTRUCTION_LEN = 1000;

type RouteParams = {
  params: Promise<{ id: string; responseId: string }>;
};

/**
 * POST /api/funding/applications/[id]/responses/[responseId]/refine
 *
 * Refine a single answer in place. Calls the LLM with the question, the current
 * answer text, the club context, and an optional user instruction. Writes the
 * new draft back to the FundingResponse with source=AI_DRAFT and returns the
 * updated row. Bypasses the proposal inbox — this is in-context editing.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id, responseId } = await params;

  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  if (!(await isFeatureEnabled(tenantId, FUNDING_FEATURE_KEY))) {
    return jsonError("Funding feature is not enabled", 403);
  }
  const permErr = await assertPermissionOrFail(
    session,
    tenantId,
    Permission.funding_manage,
  );
  if (permErr) return permErr;

  let body: { instruction?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is fine — instruction is optional.
  }

  const instruction =
    typeof body.instruction === "string"
      ? body.instruction.slice(0, MAX_INSTRUCTION_LEN)
      : undefined;

  // Load response with its application + opportunity + question, gated by tenant.
  const response = await prisma.fundingResponse.findFirst({
    where: {
      id: responseId,
      applicationId: id,
      application: { tenantId },
    },
    include: {
      application: {
        include: {
          opportunity: { select: { name: true, funder: true, description: true } },
        },
      },
      question: { select: { label: true, helpText: true } },
    },
  });
  if (!response) return jsonError("Response not found", 404);
  if (response.application.status !== "DRAFT") {
    return jsonError("Can only refine answers on DRAFT applications", 400);
  }

  const context = await aggregateTenantContext(tenantId);

  let refined;
  try {
    refined = await refineAnswer({
      opportunityName: response.application.opportunity.name,
      funder: response.application.opportunity.funder,
      opportunityDescription: response.application.opportunity.description,
      questionLabel: response.question?.label ?? response.questionLabel,
      questionHelpText: response.question?.helpText ?? null,
      currentText: response.content,
      instruction,
      context,
    });
  } catch (e) {
    return jsonError(`AI refine failed: ${(e as Error).message}`, 502);
  }

  const updated = await prisma.fundingResponse.update({
    where: { id: responseId },
    data: {
      content: refined.draftText,
      source: "AI_DRAFT",
    },
  });

  return NextResponse.json({
    response: updated,
    confidence: refined.confidence,
    notes: refined.notes,
    model: refined.model,
  });
}
