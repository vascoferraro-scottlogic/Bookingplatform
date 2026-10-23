import { moduleFlagOrFail } from "@/lib/features";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { createNotification } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import { TaskStatus, Permission } from "@prisma/client";
import { hasPermission } from "@/lib/permissions";
import { hasMaintenanceRole, maintenanceGateOrFail, TASK_PRIORITIES } from "../gate";

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

  const flagErr = await moduleFlagOrFail(session, "maintenance");
  if (flagErr) return flagErr;

  const { id } = await params;
  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

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

  if (body.priority !== undefined && !TASK_PRIORITIES.includes(body.priority)) return jsonError("Invalid priority", 400);
  if (body.status !== undefined && !(body.status in VALID_TRANSITIONS)) return jsonError("Invalid status", 400);

  const isAssigning = body.assignedToId !== undefined;
  // Assigning needs a named assignee: from the request, or already on the task (e.g. reopened).
  const requestedAssignedToId: string | null =
    isAssigning ? body.assignedToId : task.assignedToId;

  // Determine the desired status. Naming an assignee moves a new/reopened task to ASSIGNED;
  // reassigning a task already ASSIGNED or IN_PROGRESS keeps its status.
  let desiredStatus: TaskStatus = task.status;
  if (body.status) desiredStatus = body.status as TaskStatus;
  if (isAssigning && task.status !== "ASSIGNED" && task.status !== "IN_PROGRESS") desiredStatus = "ASSIGNED";
  const statusChanged = desiredStatus !== task.status;

  // Validate transition from current state (an unchanged status is not a transition).
  if (statusChanged && !VALID_TRANSITIONS[task.status]?.includes(desiredStatus)) {
    return jsonError(`Cannot transition from ${task.status} to ${desiredStatus}`, 400);
  }

  // Authorization checks (role OR permission).
  const assigning = isAssigning || desiredStatus === "ASSIGNED";
  if (assigning || desiredStatus === "REOPENED") {
    const permErr = await maintenanceGateOrFail(session, Permission.maintenance_assign);
    if (permErr) return permErr;
  } else if (statusChanged && desiredStatus === "IN_PROGRESS") {
    // Allow assigned user to start work, or users with maintenance_assign permission.
    if (eff.realUserId !== requestedAssignedToId && !hasMaintenanceRole(session)) {
      const ok = await hasPermission(session, Permission.maintenance_assign);
      if (!ok) return jsonError("Forbidden", 403);
    }
  } else if (statusChanged && desiredStatus === "CLOSED") {
    // Allow assigned user to close, or users with maintenance_close permission.
    if (eff.realUserId !== requestedAssignedToId && !hasMaintenanceRole(session)) {
      const ok = await hasPermission(session, Permission.maintenance_close);
      if (!ok) return jsonError("Forbidden", 403);
    }
  }

  // Assignment requires an assignee holding a maintenance role in this tenant (D-11).
  if (assigning) {
    if (!requestedAssignedToId || typeof requestedAssignedToId !== "string") {
      return jsonError("assignedToId required to assign a task", 400);
    }
    const assignee = await prisma.membership.findFirst({
      where: { userId: requestedAssignedToId, tenantId: task.tenantId, role: "MAINTENANCE", status: "ACTIVE" },
    });
    if (!assignee) return jsonError("Assignee must be a maintenance user of this tenant", 400);
    data.assignedToId = requestedAssignedToId;
  }
  if (statusChanged) data.status = desiredStatus;

  // Priority change (requires maintenance_assign)
  const priorityChanged = body.priority && body.priority !== task.priority;
  if (priorityChanged) {
    const permErr = await maintenanceGateOrFail(session, Permission.maintenance_assign);
    if (permErr) return permErr;
    data.priority = body.priority;
  }

  // Apply simple editable fields (title/description) if provided.
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;

  const updated = await prisma.maintenanceTask.update({ where: { id }, data });

  // Status history: a timestamped note (TaskNote.createdAt) for every status change.
  if (statusChanged) {
    await prisma.taskNote.create({
      data: { taskId: id, userId: eff.realUserId, text: `Status changed from ${task.status} to ${desiredStatus}` },
    });
  }

  if (assigning && data.assignedToId !== task.assignedToId) {
    await createNotification({
      tenantId: task.tenantId,
      userId: data.assignedToId as string,
      type: "TASK_ASSIGNED",
      title: "Task assigned to you",
      body: `You have been assigned: ${task.title}`,
    });
  }
  if (priorityChanged) {
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

  const auditAction = isAssigning ? "task.assigned" : statusChanged ? `task.${desiredStatus.toLowerCase()}` : "task.updated";
  logAudit({ session, action: auditAction, entity: "MaintenanceTask", entityId: id, tenantId: task.tenantId, meta: data });

  return NextResponse.json(updated);
}
