import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { hasRole } from "@/lib/roles";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

/** Valid status transitions: from → allowed targets */
const STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["REVIEW"],
  REVIEW: ["PUBLISHED", "DRAFT"],
  PUBLISHED: ["ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

type Params = { params: Promise<{ id: string }> };

/** GET — single content section by ID (tenant-scoped). */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const section = await prisma.contentSection.findFirst({
    where: { id, tenantId },
    include: {
      createdBy: { select: { id: true, name: true } },
      updatedBy: { select: { id: true, name: true } },
    },
  });

  if (!section) return jsonError("Not found", 404);
  return NextResponse.json(section);
}

/** PATCH — update fields, change status, toggle enabled. TENANT_ADMIN+ only. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!hasRole(getEffective(session).role, "TENANT_ADMIN")) {
    return jsonError("Forbidden", 403);
  }

  const existing = await prisma.contentSection.findFirst({ where: { id, tenantId } });
  if (!existing) return jsonError("Not found", 404);

  const body = await req.json();
  const { title, content, enabled, order, status } = body;

  // Validate status transition if requested
  if (status && status !== existing.status) {
    const allowed = STATUS_TRANSITIONS[existing.status];
    if (!allowed || !allowed.includes(status)) {
      return jsonError(`Cannot transition from ${existing.status} to ${status}`);
    }
  }

  // Validate content JSON if provided
  let contentStr: string | undefined;
  if (content !== undefined) {
    if (typeof content === "string") {
      try { JSON.parse(content); contentStr = content; } catch { return jsonError("content must be valid JSON"); }
    } else if (typeof content === "object" && content !== null) {
      contentStr = JSON.stringify(content);
    }
  }

  const section = await prisma.contentSection.update({
    where: { id },
    data: {
      ...(title !== undefined && { title }),
      ...(contentStr !== undefined && { content: contentStr }),
      ...(enabled !== undefined && { enabled }),
      ...(order !== undefined && { order }),
      ...(status !== undefined && { status }),
      updatedById: session.user.id,
    },
  });

  logAudit({
    session,
    action: status ? `content.status.${status.toLowerCase()}` : "content.updated",
    entity: "ContentSection",
    entityId: section.id,
    tenantId,
    meta: { title: section.title, ...(status && { from: existing.status, to: status }) },
  });

  return NextResponse.json(section);
}

/** DELETE — hard-delete drafts, archive anything else. TENANT_ADMIN+ only. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!hasRole(getEffective(session).role, "TENANT_ADMIN")) {
    return jsonError("Forbidden", 403);
  }

  const existing = await prisma.contentSection.findFirst({ where: { id, tenantId } });
  if (!existing) return jsonError("Not found", 404);

  if (existing.status === "DRAFT") {
    await prisma.contentSection.delete({ where: { id } });
    logAudit({ session, action: "content.deleted", entity: "ContentSection", entityId: id, tenantId });
    return NextResponse.json({ deleted: true });
  }

  // Non-draft: archive instead of hard delete
  const section = await prisma.contentSection.update({
    where: { id },
    data: { status: "ARCHIVED", updatedById: session.user.id },
  });

  logAudit({ session, action: "content.archived", entity: "ContentSection", entityId: id, tenantId });
  return NextResponse.json(section);
}
