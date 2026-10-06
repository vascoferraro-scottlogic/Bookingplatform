import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { jsonError } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/outbound";

type Params = { params: Promise<{ token: string }> };

/**
 * GET /api/invitations/[token] — fetch invitation status for the accept page.
 * Public — no auth required (token is the secret).
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params;
  const invite = await prisma.userInvitation.findUnique({
    where: { token },
    include: {
      tenant: { select: { id: true, name: true, slug: true, locality: true } },
      invitedBy: { select: { name: true, email: true } },
    },
  });
  if (!invite) return jsonError("Invitation not found", 404);

  const expired = invite.expiresAt < new Date();
  // QUEUED invitations are issued during onboarding and shouldn't be acted on
  // until the club goes live. We treat them as a stale-but-friendly state on
  // the public accept page.
  const isQueued = invite.status === "QUEUED";
  const stale = invite.status !== "PENDING" || expired || isQueued;

  return NextResponse.json({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
    tenant: invite.tenant,
    invitedBy: invite.invitedBy,
    status: expired && invite.status === "PENDING" ? "EXPIRED" : invite.status,
    stale,
  });
}

/**
 * POST /api/invitations/[token]/accept
 *
 * Body: `{ password, name? }`
 *
 * Sets the user's password (overwriting the placeholder hash), activates
 * the membership, marks the invitation accepted, stubs a welcome email.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;

  let body: { password?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8) return jsonError("Password must be at least 8 characters");

  const invite = await prisma.userInvitation.findUnique({
    where: { token },
    include: { tenant: { select: { id: true, name: true, slug: true, locality: true } } },
  });
  if (!invite) return jsonError("Invitation not found", 404);
  if (invite.status === "QUEUED") {
    return jsonError(
      "This invitation is queued and not yet ready. The club admin hasn't gone live yet \u2014 please check back once they do.",
      409,
    );
  }
  if (invite.status !== "PENDING") return jsonError("Invitation already used or revoked", 409);
  if (invite.expiresAt < new Date()) {
    await prisma.userInvitation.update({
      where: { id: invite.id },
      data: { status: "EXPIRED" },
    });
    return jsonError("Invitation expired", 410);
  }

  const user = await prisma.user.findUnique({ where: { email: invite.email } });
  if (!user) return jsonError("Invited user no longer exists", 404);

  const passwordHash = await bcrypt.hash(password, 12);

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : user.name;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, name },
    }),
    prisma.membership.updateMany({
      where: { userId: user.id, tenantId: invite.tenantId },
      data: { status: "ACTIVE" },
    }),
    prisma.userInvitation.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    }),
  ]);

  await sendEmail({
    to: user.email,
    subject: `Welcome to ${invite.tenant.name}`,
    template: "welcome",
    data: {
      name: name ?? user.email,
      clubName: invite.tenant.name,
      loginUrl: `${process.env.NEXTAUTH_URL ?? ""}/auth/login`,
    },
    tenantId: invite.tenantId,
    relatedEntity: "UserInvitation",
    relatedEntityId: invite.id,
  });

  logAudit({
    session: { user: { id: user.id, role: invite.role, tenantId: invite.tenantId } },
    action: "invitation.accepted",
    entity: "UserInvitation",
    entityId: invite.id,
    tenantId: invite.tenantId,
  });

  return NextResponse.json({
    ok: true,
    email: user.email,
    tenantSlug: invite.tenant.slug,
  });
}
