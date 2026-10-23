import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { hasRole } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import { findMembership } from "@/lib/memberships";
import type { MembershipStatus, Role } from "@prisma/client";

const TENANT_ROLES: Role[] = ["GUEST", "USER", "MAINTENANCE", "TENANT_ADMIN"];

/** Get a single user with details. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const { id } = await params;

  // passwordHash is never selected, whatever the detail mode (NFR-05).
  const selectFields = { id: true, email: true, name: true, role: true, suspended: true, tenantId: true, createdAt: true, bookings: { select: { id: true, date: true, status: true }, orderBy: { date: "desc" as const }, take: 10 }, _count: { select: { bookings: true, submittedTasks: true } } };

  const user = await prisma.user.findUnique({
    where: { id },
    select: selectFields,
  });

  if (!user) return jsonError("User not found", 404);

  // Tenant admins can only see users in their effective tenant.
  const eff = getEffective(session);
  if (user.tenantId !== eff.tenantId) {
    return jsonError("Forbidden", 403);
  }

  logAudit({ session, action: "pii.user_detail_viewed", entity: "User", entityId: user.id, piiAccess: true, tenantId: user.tenantId });

  return NextResponse.json(user);
}

/** Update user (suspend/activate, role). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const { id } = await params;

  // Prevent self-modification
  if (id === session.user.id) {
    return jsonError("Cannot modify your own account", 400);
  }

  const target = await prisma.user.findUnique({ where: { id }, select: { tenantId: true, role: true } });
  if (!target) return jsonError("User not found", 404);

  const eff = getEffective(session);
  const membership = eff.tenantId ? await findMembership(id, eff.tenantId) : null;
  if (!membership && target.tenantId !== eff.tenantId) {
    return jsonError("Forbidden", 403);
  }
  const targetRole = membership?.role ?? target.role;

  // Real platform admins (including while impersonating) may modify any
  // tenant-plane user including other tenant admins. Real tenant admins may
  // not modify other admins or platform admins.
  const isRealPlatformAdmin = session.user.role === "PLATFORM_ADMIN";
  if (!isRealPlatformAdmin && hasRole(targetRole, "TENANT_ADMIN")) {
    return jsonError("Cannot modify admin users", 403);
  }
  if (!isRealPlatformAdmin && targetRole === "PLATFORM_ADMIN" || target.role === "PLATFORM_ADMIN") {
    return jsonError("Cannot modify platform admin users", 403);
  }

  let data: Record<string, unknown>;
  try {
    data = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  // Roles are validated against the tenant roles: PLATFORM_ADMIN can never be
  // granted through this endpoint, by anyone (FR-SEC-006).
  if (data.role !== undefined && !TENANT_ROLES.includes(data.role as Role)) {
    return jsonError("Invalid role", 400);
  }

  const allowed: Record<string, unknown> = {};
  if (typeof data.suspended === "boolean") allowed.suspended = data.suspended;
  // Only real platform admins can change roles (even while impersonating).
  if (isRealPlatformAdmin && data.role) allowed.role = data.role;

  if (Object.keys(allowed).length === 0) {
    return jsonError("No valid fields to update");
  }

  try {
    // Role and suspension live on the Membership for this tenant; the global
    // User row is only touched for legacy users that have no membership here.
    const memberData: { role?: Role; status?: MembershipStatus } = {};
    if (allowed.role) memberData.role = allowed.role as Role;
    if (typeof allowed.suspended === "boolean") memberData.status = allowed.suspended ? "SUSPENDED" : "ACTIVE";

    let updated;
    if (membership) {
      await prisma.membership.update({ where: { userId_tenantId: { userId: id, tenantId: membership.tenantId } }, data: memberData });
      updated = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, role: true, suspended: true } });
      updated = { ...updated, role: memberData.role ?? membership.role, suspended: memberData.status ? memberData.status === "SUSPENDED" : membership.status === "SUSPENDED" };
    } else {
      updated = await prisma.user.update({
        where: { id },
        data: allowed,
        select: { id: true, email: true, name: true, role: true, suspended: true },
      });
    }

    const auditAction = allowed.suspended === true ? "admin.user.suspended" : allowed.suspended === false ? "admin.user.activated" : "admin.user.updated";
    logAudit({ session, action: auditAction, entity: "User", entityId: id, tenantId: target.tenantId, meta: allowed });

    return NextResponse.json(updated);
  } catch {
    return jsonError("Failed to update user", 500);
  }
}
