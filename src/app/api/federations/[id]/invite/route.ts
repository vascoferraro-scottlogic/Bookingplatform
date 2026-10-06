import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { isFeatureEnabled } from "@/lib/features";

const MAX_INVITES_PER_DAY = 5;

/**
 * POST /api/federations/[id]/invite — invite a club to join a federation.
 * Body: { tenantSlug: string }
 *
 * Caller must be a TENANT_ADMIN of a member club.
 * Invited club must not already be a member or have a pending invite.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;
  const { tenantId, error: tErr } = resolveTenantId(session);
  if (tErr) return tErr;

  if (!(await isFeatureEnabled(tenantId, "federation"))) {
    return jsonError("Federation feature is not enabled", 403);
  }

  // Caller must be a member
  const myMembership = await prisma.federationMembership.findFirst({
    where: { federationId: id, tenantId, leftAt: null },
  });
  if (!myMembership) return jsonError("You are not a member of this federation", 403);

  const federation = await prisma.federation.findUnique({ where: { id } });
  if (!federation || federation.status !== "ACTIVE") {
    return jsonError("Federation not found or not active", 404);
  }

  // Rate limit: max invites per day for this federation
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentInvites = await prisma.federationInvite.count({
    where: { federationId: id, createdAt: { gte: dayAgo } },
  });
  if (recentInvites >= MAX_INVITES_PER_DAY) {
    return jsonError(`Maximum ${MAX_INVITES_PER_DAY} invitations per day per federation`, 429);
  }

  const body = await req.json();
  const slug = (body.tenantSlug ?? "").trim();
  if (!slug) return jsonError("tenantSlug is required", 400);

  // Find the invited club
  const invitee = await prisma.tenant.findUnique({ where: { slug } });
  if (!invitee) return jsonError("Club not found", 404);
  if (invitee.id === tenantId) return jsonError("Cannot invite yourself", 400);

  // Check club isn't already a member
  const existingMembership = await prisma.federationMembership.findFirst({
    where: { federationId: id, tenantId: invitee.id, leftAt: null },
  });
  if (existingMembership) return jsonError("Club is already a member", 409);

  // Check no pending invite exists
  const existingInvite = await prisma.federationInvite.findFirst({
    where: { federationId: id, inviteeTenantId: invitee.id, status: "PENDING" },
  });
  if (existingInvite) return jsonError("A pending invitation already exists for this club", 409);

  // Check federation capacity
  const memberCount = await prisma.federationMembership.count({
    where: { federationId: id, leftAt: null },
  });
  if (memberCount >= federation.maxClubs) {
    return jsonError(`Federation is at capacity (${federation.maxClubs} clubs)`, 400);
  }

  const invite = await prisma.federationInvite.create({
    data: {
      federationId: id,
      inviterTenantId: tenantId,
      inviteeTenantId: invitee.id,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
    },
    include: {
      inviteeTenant: { select: { id: true, name: true, slug: true, locality: true } },
    },
  });

  return NextResponse.json(invite, { status: 201 });
}
