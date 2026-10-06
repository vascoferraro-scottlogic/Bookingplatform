import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { hasRole } from "@/lib/roles";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

const VALID_TYPES = ["HERO", "ABOUT", "PHOTO", "MAP", "CONTACT"] as const;

/** GET — list content sections for a tenant.
 *  Unauthenticated / non-admin callers get only published + enabled sections.
 *  Tenant admins get all sections (for CMS management). */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const isAdmin = hasRole(getEffective(session).role, "TENANT_ADMIN");

  const sections = await prisma.contentSection.findMany({
    where: {
      tenantId,
      ...(!isAdmin ? { status: "PUBLISHED", enabled: true } : {}),
    },
    include: {
      createdBy: { select: { id: true, name: true } },
      updatedBy: { select: { id: true, name: true } },
    },
    orderBy: { order: "asc" },
  });

  return NextResponse.json(sections);
}

/** POST — create a new content section. TENANT_ADMIN+ only. */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  if (!hasRole(getEffective(session).role, "TENANT_ADMIN")) {
    return jsonError("Forbidden", 403);
  }

  const body = await req.json();
  const { type, title, content, enabled, order } = body;

  if (!type || !title) return jsonError("type and title are required");
  if (!VALID_TYPES.includes(type)) return jsonError(`Invalid type. Must be one of: ${VALID_TYPES.join(", ")}`);

  // Validate content is parseable JSON string or object
  let contentStr: string;
  if (typeof content === "string") {
    try { JSON.parse(content); contentStr = content; } catch { return jsonError("content must be valid JSON"); }
  } else if (typeof content === "object" && content !== null) {
    contentStr = JSON.stringify(content);
  } else {
    contentStr = "{}";
  }

  const section = await prisma.contentSection.create({
    data: {
      tenantId,
      type,
      title,
      content: contentStr,
      enabled: enabled ?? true,
      order: order ?? 0,
      createdById: session.user.id,
    },
  });

  logAudit({
    session,
    action: "content.created",
    entity: "ContentSection",
    entityId: section.id,
    tenantId,
    meta: { type, title },
  });

  return NextResponse.json(section, { status: 201 });
}
