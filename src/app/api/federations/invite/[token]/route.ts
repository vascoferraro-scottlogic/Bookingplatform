import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";

const MAX_FEDERATIONS_PER_CLUB = 3;

/**
 * GET /api/federations/invite/[token] — fetch invitation details.
 * Returns invite metadata so the receiving TENANT_ADMIN can accept/decline.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const invite = await prisma.federationInvite.findUnique({
    where: { token },
    include: {
      federation: { select: { id: true, name: true, description: true, status: true } },
      inviterTenant: { select: { id: true, name: true, slug: true, locality: true } },
      inviteeTenant: { select: { id: true, name: true, slug: true } },
    },
  });

  if (!invite) return jsonError("Invitation not found", 404);

  return NextResponse.json(invite);
}

/**
 * POST /api/federations/invite/[token]/accept — accept a federation invitation.
 * Caller must be TENANT_ADMIN of the invited club.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;
  const { tenantId, error: tErr } = resolveTenantId(session);
  if (tErr) return tErr;

  const invite = await prisma.federationInvite.findUnique({
    where: { token },
    include: { federation: true },
  });

  if (!invite) return jsonError("Invitation not found", 404);
  if (invite.status !== "PENDING") return jsonError(`Invitation is ${invite.status.toLowerCase()}`, 400);
  if (invite.inviteeTenantId !== tenantId) return jsonError("This invitation is for a different club", 403);
  if (new Date() > invite.expiresAt) {
    await prisma.federationInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
    return jsonError("Invitation has expired", 400);
  }
  if (invite.federation.status !== "ACTIVE") {
    return jsonError("Federation is not active", 400);
  }

  // Check max federations per club
  const currentCount = await prisma.federationMembership.count({
    where: { tenantId, leftAt: null },
  });
  if (currentCount >= MAX_FEDERATIONS_PER_CLUB) {
    return jsonError(`A club can belong to at most ${MAX_FEDERATIONS_PER_CLUB} federations`, 400);
  }

  // Check federation capacity
  const memberCount = await prisma.federationMembership.count({
    where: { federationId: invite.federationId, leftAt: null },
  });
  if (memberCount >= invite.federation.maxClubs) {
    return jsonError(`Federation is at capacity (${invite.federation.maxClubs} clubs)`, 400);
  }

  // Accept: create membership + update invite status
  await prisma.$transaction([
    prisma.federationMembership.create({
      data: {
        federationId: invite.federationId,
        tenantId,
        billingMode: "HOST_CLUB_RATE",
      },
    }),
    prisma.federationInvite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED" },
    }),
  ]);

  return NextResponse.json({ ok: true, federationId: invite.federationId });
}
