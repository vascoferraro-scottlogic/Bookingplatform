import type { NextResponse } from "next/server";
import type { Permission } from "@prisma/client";
import { getEffectiveRole } from "@/lib/roles";
import { assertPermissionOrFail } from "@/lib/permissions";
import type { AppSession } from "@/lib/api-utils";

/** True for the MAINTENANCE role (or TENANT_ADMIN), effective-role aware. */
export function hasMaintenanceRole(session: AppSession): boolean {
  const role = getEffectiveRole(session.user).role;
  return role === "MAINTENANCE" || role === "TENANT_ADMIN";
}

/**
 * Dual gate (FR-SEC-008): the MAINTENANCE role (or TENANT_ADMIN) is enough,
 * otherwise the user needs the permission via a group grant.
 */
export async function maintenanceGateOrFail(session: AppSession, permission: Permission): Promise<NextResponse | null> {
  if (hasMaintenanceRole(session)) return null;
  return assertPermissionOrFail(session, permission);
}

export const TASK_CATEGORIES = ["GENERAL", "RINK_SURFACE", "EQUIPMENT", "FACILITIES", "SAFETY", "GROUNDS", "OTHER", "PREVENTIVE"];
export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
