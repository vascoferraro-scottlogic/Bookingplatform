import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { assertPermissionOrFail } from "@/lib/permissions";
import { Permission } from "@prisma/client";
import { hasRole } from "@/lib/roles";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import type { Prisma, TaskCategory, TaskPriority } from "@prisma/client";

/** List tasks — visibility-filtered by viewer role.
 *
 * Visibility rules (decisions log 2026-05-03 — member-message-derived tasks):
 *  - TENANT_ADMIN+: sees all tasks for the tenant.
 *  - MAINTENANCE: sees (own submitted OR own assigned OR MAINTENANCE_ONLY).
 *    The MAINTENANCE_ONLY clause is the agent triage queue — without it,
 *    agent-derived tasks would land invisibly.
 *  - USER (member): sees (own submitted OR MEMBERS-visible OR PUBLIC-visible).
 *    Pre-v2 members only saw own-submitted tasks; the visibility model
 *    intentionally broadens the member view to tasks the maintenance team
 *    has flagged as member-visible.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  try {
    const eff = getEffective(session);
    const isAdmin = hasRole(eff.role, "TENANT_ADMIN");
    const isMaintenance = eff.role === "MAINTENANCE";

    const visibilityFilter: Prisma.MaintenanceTaskWhereInput = isAdmin
      ? {}
      : isMaintenance
        ? {
            OR: [
              { assignedToId: session.user.id },
              { submittedById: session.user.id },
              { visibility: "MAINTENANCE_ONLY" },
            ],
          }
        : {
            OR: [
              { submittedById: session.user.id },
              { visibility: { in: ["MEMBERS", "PUBLIC"] } },
            ],
          };

    const tasks = await prisma.maintenanceTask.findMany({
      where: { tenantId, ...visibilityFilter },
      include: {
        submittedBy: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
        notes: { orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(tasks);
  } catch {
    return jsonError("Failed to fetch tasks", 500);
  }
}

/** Submit a new task. Requires at least USER role. */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  // Require explicit `maintenance_create` permission (via groups), or TENANT_ADMIN bypass.
  // Agent-generated tasks still use the committer flow and default to
  // MAINTENANCE_ONLY visibility; human-submitted tasks default to MEMBERS.
  const permErr = await assertPermissionOrFail(session, Permission.maintenance_create);
  if (permErr) return permErr;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const { title, description, category, priority } = body as {
    title?: string; description?: string; category?: TaskCategory; priority?: TaskPriority;
  };
  if (!title || !description) return jsonError("title and description required");

  try {
    const task = await prisma.maintenanceTask.create({
      data: {
        tenantId,
        title,
        description,
        category: category ?? "GENERAL",
        priority: priority ?? "MEDIUM",
        // Human-submitted tasks default to MEMBERS visibility (preserves
        // existing behaviour). Agent-emitted tasks omit the field and pick
        // up the column default of MAINTENANCE_ONLY. See decisions log
        // 2026-05-03 (member-message-derived tasks).
        visibility: "MEMBERS",
        submittedById: session.user.id,
      },
    });

    logAudit({ session, action: "task.created", entity: "MaintenanceTask", entityId: task.id, tenantId, meta: { title, category: category ?? "GENERAL" } });

    return NextResponse.json(task, { status: 201 });
  } catch {
    return jsonError("Failed to create task", 500);
  }
}
