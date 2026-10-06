import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { getSessionOrFail, assertEffectiveRoleOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/outbound";
import { Role, MembershipKind } from "@prisma/client";

const INVITATION_DAYS = 14;
const ALLOWED_ROLES: Role[] = ["USER", "MAINTENANCE", "TENANT_ADMIN"];
const ALLOWED_KINDS: MembershipKind[] = ["MEMBER", "STAFF", "CONTRACTOR", "VOLUNTEER"];

/**
 * POST /api/onboarding/invite — invite someone to help run the club.
 * Body: { email, name?, role?, kind?, specialism? }
 * Creates a User (if missing) with a placeholder password hash, a PENDING
 * Membership, and a UserInvitation; stubs an invitation email.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const eff = getEffective(session);
  const tenantId = eff.tenantId;
  if (!tenantId) return jsonError("No tenant context", 400);

  let body: { email?: string; name?: string; role?: Role; kind?: MembershipKind; specialism?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return jsonError("Valid email required");
  const role: Role = body.role && ALLOWED_ROLES.includes(body.role) ? body.role : "USER";
  const kind: MembershipKind = body.kind && ALLOWED_KINDS.includes(body.kind) ? body.kind : "MEMBER";

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, slug: true, status: true } });
  if (!tenant) return jsonError("Tenant not found", 404);

  // Tenants pre-go-live: invitations are QUEUED (held back, no email stub
  // fired yet). At go-live they're released to PENDING and emails go out.
  // Tenants already live: invitations are PENDING immediately (current
  // post-go-live invite flow).
  const initialStatus = tenant.status === "ACTIVE" ? "PENDING" : "QUEUED";

  // Reuse-or-create user
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const placeholder = await bcrypt.hash(randomBytes(24).toString("hex"), 10);
    user = await prisma.user.create({
      data: {
        email,
        name: body.name?.trim() || null,
        passwordHash: placeholder,
        role,
        tenantId,
        specialisms: body.specialism?.trim() || null,
      },
    });
  }

  // Idempotent: if there's already an active membership, just return.
  const existingMembership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId } },
  });
  if (existingMembership && existingMembership.status === "ACTIVE") {
    return NextResponse.json({ alreadyActive: true, userId: user.id }, { status: 200 });
  }

  // Create / update PENDING membership
  if (!existingMembership) {
    await prisma.membership.create({
      data: { userId: user.id, tenantId, role, kind, status: "PENDING" },
    });
  }

  // Reuse pending/queued invitation if any, else create fresh.
  let invitation = await prisma.userInvitation.findFirst({
    where: { email, tenantId, status: { in: ["QUEUED", "PENDING"] } },
  });
  const expires = new Date(Date.now() + INVITATION_DAYS * 24 * 3600 * 1000);
  if (!invitation) {
    invitation = await prisma.userInvitation.create({
      data: {
        email,
        tenantId,
        role,
        kind,
        invitedById: session.user.id,
        expiresAt: expires,
        status: initialStatus,
      },
    });
  }

  const acceptUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/invite/${invitation.token}`;

  // Only fire the outbound stub for already-live tenants. For ONBOARDING,
  // the stub fires at go-live when the invitation is released.
  if (initialStatus === "PENDING") {
    await sendEmail({
      to: email,
      subject: `You've been invited to ${tenant.name}`,
      template: "invitation",
      data: {
        recipientName: body.name || email,
        tenantName: tenant.name,
        inviterName: session.user.name || session.user.email,
        acceptUrl,
        role,
      },
      tenantId,
      relatedEntity: "UserInvitation",
      relatedEntityId: invitation.id,
    });
  }

  logAudit({
    session,
    action: initialStatus === "QUEUED" ? "onboarding.user.invited.queued" : "onboarding.user.invited",
    entity: "UserInvitation",
    entityId: invitation.id,
    tenantId,
    meta: { email, role, kind, status: initialStatus },
  });

  return NextResponse.json({ userId: user.id, invitationId: invitation.id, email, role, kind, status: invitation.status }, { status: 201 });
}

/** GET /api/onboarding/invite — list memberships + pending invitations for this tenant. */
export async function GET(_req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const tenantId = getEffective(session).tenantId;
  if (!tenantId) return jsonError("No tenant context", 400);

  const [memberships, invitations] = await Promise.all([
    prisma.membership.findMany({
      where: { tenantId },
      include: { user: { select: { email: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.userInvitation.findMany({
      where: { tenantId, status: { in: ["QUEUED", "PENDING"] } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return NextResponse.json({ memberships, invitations });
}
