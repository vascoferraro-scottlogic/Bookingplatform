import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";

/**
 * POST /api/platform/impersonation
 *
 * Body: `{ tenantId: string, reason?: string }`
 *
 * Starts an impersonation session for the calling PLATFORM_ADMIN. Creates an
 * `Impersonation` row and returns the claim to embed on the JWT (the client
 * is expected to call `useSession().update({ actingAs: ... })` immediately).
 *
 * Idempotent in spirit: if the caller already has an active impersonation we
 * end it first so there is exactly one active row per platform admin at a time.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  if (session.user.role !== "PLATFORM_ADMIN") {
    return jsonError("Only platform admins may impersonate.", 403);
  }

  let body: { tenantId?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
  if (!tenantId) return jsonError("tenantId is required.", 400);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, slug: true, active: true, status: true },
  });
  if (!tenant) return jsonError("Tenant not found.", 404);
  // Allow impersonation for ACTIVE and ONBOARDING tenants. Block SUSPENDED
  // and CHURNED — those are platform-disciplinary states; impersonating one
  // would let a platform admin sidestep the suspension.
  if (tenant.status !== "ACTIVE" && tenant.status !== "ONBOARDING") {
    return jsonError(`Cannot impersonate a tenant in ${tenant.status} state.`, 400);
  }

  // End any prior open impersonations for this platform admin.
  await prisma.impersonation.updateMany({
    where: { platformUserId: session.user.id, endedAt: null },
    data: { endedAt: new Date() },
  });

  const record = await prisma.impersonation.create({
    data: {
      platformUserId: session.user.id,
      tenantId: tenant.id,
      assumedRole: "TENANT_ADMIN",
      reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : null,
    },
  });

  logAudit({
    session,
    action: "platform.impersonation.start",
    entity: "Impersonation",
    entityId: record.id,
    tenantId: tenant.id,
    meta: { tenantSlug: tenant.slug, tenantName: tenant.name, reason: record.reason },
  });

  return NextResponse.json({
    actingAs: {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      role: "TENANT_ADMIN",
      impersonationId: record.id,
      startedAt: record.startedAt.toISOString(),
    },
  });
}

/**
 * DELETE /api/platform/impersonation
 *
 * Ends the caller's active impersonation. Safe to call when none is active
 * (returns `{ ended: false }`).
 */
export async function DELETE() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  if (session.user.role !== "PLATFORM_ADMIN") {
    return jsonError("Only platform admins may impersonate.", 403);
  }

  if (!session.user.actingAs) {
    return NextResponse.json({ ended: false });
  }

  const impersonationId = session.user.actingAs.impersonationId;

  await prisma.impersonation.updateMany({
    where: {
      id: impersonationId,
      platformUserId: session.user.id,
      endedAt: null,
    },
    data: { endedAt: new Date() },
  });

  logAudit({
    session,
    action: "platform.impersonation.end",
    entity: "Impersonation",
    entityId: impersonationId,
    tenantId: session.user.actingAs.tenantId,
    meta: { tenantSlug: session.user.actingAs.tenantSlug, tenantName: session.user.actingAs.tenantName },
  });

  return NextResponse.json({ ended: true });
}

/**
 * GET /api/platform/impersonation
 *
 * Returns the caller's currently-active impersonation (or `{ active: null }`).
 * Useful for the banner to recover state on a page reload.
 */
export async function GET() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  if (session.user.role !== "PLATFORM_ADMIN") {
    return jsonError("Only platform admins may impersonate.", 403);
  }

  return NextResponse.json({ active: session.user.actingAs ?? null });
}
