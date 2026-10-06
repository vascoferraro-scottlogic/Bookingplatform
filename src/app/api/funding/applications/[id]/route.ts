import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";
import { assertPermissionOrFail } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { FundingApplicationStatus } from "@prisma/client";

const FUNDING_FEATURE_KEY = "funding";

const VALID_STATUSES: FundingApplicationStatus[] = [
  "DRAFT", "SUBMITTED", "PENDING_DECISION", "APPROVED", "REJECTED", "WITHDRAWN",
];

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/funding/applications/[id]
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
  const permErr = await assertPermissionOrFail(session, "funding_view");
  if (permErr) return permErr;

  const application = await prisma.fundingApplication.findFirst({
    where: { id, tenantId },
    include: {
      opportunity: {
        include: { questions: { orderBy: { sortOrder: "asc" } } },
      },
      responses: { orderBy: { createdAt: "asc" } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });
  if (!application) return jsonError("Application not found", 404);

  return NextResponse.json(application);
}

/**
 * PATCH /api/funding/applications/[id]
 * Update status, amounts, or notes.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  if (!(await isFeatureEnabled(tenantId, FUNDING_FEATURE_KEY))) {
    return jsonError("Funding feature is not enabled", 403);
  }
  const permErr = await assertPermissionOrFail(session, "funding_manage");
  if (permErr) return permErr;

  let body: {
    status?: string;
    amountRequested?: number | null;
    amountAwarded?: number | null;
    notes?: string | null;
    submittedAt?: string | null;
    decisionAt?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  const existing = await prisma.fundingApplication.findFirst({
    where: { id, tenantId },
  });
  if (!existing) return jsonError("Application not found", 404);

  const data: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status as FundingApplicationStatus)) {
      return jsonError(`Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`);
    }
    data.status = body.status;
    if (body.status === "SUBMITTED" && !existing.submittedAt) {
      data.submittedAt = new Date();
    }
  }
  if (body.amountRequested !== undefined) {
    if (body.amountRequested !== null && (!Number.isInteger(body.amountRequested) || body.amountRequested <= 0)) {
      return jsonError("amountRequested must be a positive integer (pence) or null");
    }
    data.amountRequested = body.amountRequested;
  }
  if (body.amountAwarded !== undefined) {
    if (body.amountAwarded !== null && (!Number.isInteger(body.amountAwarded) || body.amountAwarded <= 0)) {
      return jsonError("amountAwarded must be a positive integer (pence) or null");
    }
    data.amountAwarded = body.amountAwarded;
  }
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.submittedAt !== undefined) data.submittedAt = body.submittedAt ? new Date(body.submittedAt) : null;
  if (body.decisionAt !== undefined) data.decisionAt = body.decisionAt ? new Date(body.decisionAt) : null;

  if (Object.keys(data).length === 0) return jsonError("No fields to update");

  // Match GET include structure so PATCH returns all fields needed by the UI
  const updated = await prisma.fundingApplication.update({
    where: { id },
    data,
    include: {
      opportunity: {
        include: { questions: { orderBy: { sortOrder: "asc" } } },
      },
      responses: { orderBy: { createdAt: "asc" } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  logAudit({
    session,
    action: "funding.application.updated",
    entity: "FundingApplication",
    entityId: id,
    tenantId,
    meta: { fields: Object.keys(data) },
  });

  return NextResponse.json(updated);
}

/**
 * DELETE /api/funding/applications/[id]
 * Only DRAFT applications can be deleted.
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  if (!(await isFeatureEnabled(tenantId, FUNDING_FEATURE_KEY))) {
    return jsonError("Funding feature is not enabled", 403);
  }
  const permErr = await assertPermissionOrFail(session, "funding_manage");
  if (permErr) return permErr;

  const existing = await prisma.fundingApplication.findFirst({
    where: { id, tenantId },
  });
  if (!existing) return jsonError("Application not found", 404);
  if (existing.status !== "DRAFT") {
    return jsonError("Only draft applications can be deleted", 409);
  }

  await prisma.fundingApplication.delete({ where: { id } });

  logAudit({
    session,
    action: "funding.application.deleted",
    entity: "FundingApplication",
    entityId: id,
    tenantId,
  });

  return NextResponse.json({ deleted: true });
}
