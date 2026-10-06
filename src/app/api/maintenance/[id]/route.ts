import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { createNotification } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import { TaskStatus, Permission } from "@prisma/client";
import { assertPermissionOrFail, hasPermission } from "@/lib/permissions";

const VALID_TRANSITIONS: Record<string, TaskStatus[]> = {
  SUBMITTED: ["ASSIGNED"],
  ASSIGNED: ["IN_PROGRESS", "CLOSED"],
  IN_PROGRESS: ["CLOSED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["ASSIGNED"],
};

/** Update task: assign, change status, edit priority. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const body = await req.json();

  const task = await prisma.maintenanceTask.findUnique({ where: { id } });
  if (!task) return jsonError("Not found", 404);

  // Tenant isolation via effective tenant context (impersonation-aware).
  const eff = getEffective(session);
  if (task.tenantId !== eff.tenantId) {
    if (session.user.role === "PLATFORM_ADMIN" && !eff.isImpersonating) {
      return jsonError("PLATFORM_ADMIN_NO_CONTEXT", 403);
    }
    return jsonError("Forbidden", 403);
  }

  const data: Record<string, unknown> = {};
  // Determine the requested assignee and desired status. Assignment overrides status.
  const requestedAssignedToId = body.assignedToId !== undefined ? body.assignedToId : task.assignedToId;
  let desiredStatus: TaskStatus = task.status;
  if (body.status) desiredStatus = body.status as TaskStatus;
  if (body.assignedToId !== undefined) desiredStatus = "ASSIGNED";

  // Validate transition from current state.
  const allowed = VALID_TRANSITIONS[task.status];
  if (!allowed?.includes(desiredStatus)) {
    return jsonError(`Cannot transition from ${task.status} to ${desiredStatus}`, 400);
  }

  // Authorization checks for status transitions.
  if (desiredStatus === "ASSIGNED" || desiredStatus === "REOPENED") {
    const permErr = await assertPermissionOrFail(session, Permission.maintenance_assign);
    if (permErr) return permErr;
  } else if (desiredStatus === "IN_PROGRESS") {
    // Allow assigned user to start work, or users with maintenance_assign permission.
    if (eff.realUserId !== requestedAssignedToId) {
      const ok = await hasPermission(session, Permission.maintenance_assign);
      if (!ok) return jsonError("Forbidden", 403);
    }
  } else if (desiredStatus === "CLOSED") {
    // Allow assigned user to close, or users with maintenance_close permission.
    if (eff.realUserId !== requestedAssignedToId) {
      const ok = await hasPermission(session, Permission.maintenance_close);
      if (!ok) return jsonError("Forbidden", 403);
    }
  }

  // Assignment (requires maintenance_assign)
  if (body.assignedToId !== undefined) {
    const permErr = await assertPermissionOrFail(session, Permission.maintenance_assign);
    if (permErr) return permErr;
    data.assignedToId = body.assignedToId;
    data.status = "ASSIGNED";

    // Notify the assignee
    if (body.assignedToId) {
      await createNotification({
        tenantId: task.tenantId,
        userId: body.assignedToId,
        type: "TASK_ASSIGNED",
        title: "Task assigned to you",
        body: `You have been assigned: ${task.title}`,
      });
    }
  } else {
    // If no assignment update, apply explicit status change if requested.
    if (body.status) {
      data.status = body.status;
    }
  }

  // Priority change (requires maintenance_assign)
  if (body.priority && body.priority !== task.priority) {
    const permErr = await assertPermissionOrFail(session, Permission.maintenance_assign);
    if (permErr) return permErr;
    data.priority = body.priority;

    const notifyAssigneeId = (data.assignedToId as string | undefined) ?? task.assignedToId;
    if (notifyAssigneeId) {
      await createNotification({
        tenantId: task.tenantId,
        userId: notifyAssigneeId,
        type: "TASK_PRIORITY_CHANGED",
        title: "Task priority changed",
        body: `"${task.title}" priority changed to ${body.priority}.`,
      });
    }
  }

  // Apply simple editable fields (title/description) if provided.
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;

  const updated = await prisma.maintenanceTask.update({ where: { id }, data });

  const auditAction = body.assignedToId !== undefined ? "task.assigned" : body.status ? `task.${body.status.toLowerCase()}` : "task.updated";
  logAudit({ session, action: auditAction, entity: "MaintenanceTask", entityId: id, tenantId: task.tenantId, meta: data });

  return NextResponse.json(updated);
}
