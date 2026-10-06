import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import { TaskVisibility } from "@prisma/client";

const ALLOWED: TaskVisibility[] = ["MAINTENANCE_ONLY", "MEMBERS", "PUBLIC"];

/** Promote / demote a task's visibility. MAINTENANCE+ only.
 *
 * See decisions log 2026-05-03 (member-message-derived tasks). Agent-derived
 * tasks land at MAINTENANCE_ONLY by default; this endpoint is how the
 * maintenance team makes them member-visible after triage.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const roleErr = assertEffectiveRoleOrFail(session, "MAINTENANCE");
  if (roleErr) return roleErr;

  const { id } = await params;

  let body: { visibility?: TaskVisibility };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (!body.visibility || !ALLOWED.includes(body.visibility)) {
    return jsonError("visibility must be one of MAINTENANCE_ONLY, MEMBERS, PUBLIC", 400);
  }

  const task = await prisma.maintenanceTask.findUnique({ where: { id } });
  if (!task) return jsonError("Not found", 404);

  const eff = getEffective(session);
  if (task.tenantId !== eff.tenantId) {
    if (session.user.role === "PLATFORM_ADMIN" && !eff.isImpersonating) {
      return jsonError("PLATFORM_ADMIN_NO_CONTEXT", 403);
    }
    return jsonError("Forbidden", 403);
  }

  if (task.visibility === body.visibility) {
    return NextResponse.json(task);
  }

  const updated = await prisma.maintenanceTask.update({
    where: { id },
    data: { visibility: body.visibility },
  });

  logAudit({
    session,
    action: "task.visibility_changed",
    entity: "MaintenanceTask",
    entityId: id,
    tenantId: task.tenantId,
    meta: { from: task.visibility, to: body.visibility },
  });

  return NextResponse.json(updated);
}
