import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import {
  getSessionOrFail,
  assertRoleOrFail,
  rejectIfImpersonating,
  jsonError,
} from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/outbound";

type Params = { params: Promise<{ id: string }> };

const INVITATION_DAYS = 14;

/**
 * Generate a placeholder slug like `t-3f9c2b1a`. The admin picks the real,
 * public-facing slug during the onboarding wizard (About chapter). Until
 * they do, the tenant has an unguessable internal handle that nae admin
 * would think to share.
 */
function placeholderSlug(): string {
  return `t-${randomBytes(4).toString("hex")}`;
}

async function uniquePlaceholderSlug(): Promise<string> {
  // Collisions are vanishingly unlikely (1 in ~4B per attempt) but loop just in case.
  for (let i = 0; i < 5; i++) {
    const candidate = placeholderSlug();
    const exists = await prisma.tenant.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  // Pathological — fall back to a longer random tail.
  return `t-${randomBytes(8).toString("hex")}`;
}

/**
 * POST /api/admin/applications/[id]/approve
 *
 * Body: `{ decisionNotes?: string }` (slug deferred — admin picks it during onboarding).
 *
 * Provisions a new tenant in ONBOARDING status with an internal placeholder
 * slug (not safe to share publicly), creates the first TENANT_ADMIN user
 * (with placeholder password), creates a UserInvitation, stubs an approval
 * email + invitation email. The 'tenant joined' social post is deferred
 * until go-live (no public URL exists yet).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const { id } = await params;

  let body: { decisionNotes?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }

  const app = await prisma.tenantApplication.findUnique({ where: { id } });
  if (!app) return jsonError("Application not found", 404);
  if (app.status === "APPROVED") return jsonError("Already approved", 409);

  // Placeholder slug — the admin picks the real one during onboarding.
  const slug = await uniquePlaceholderSlug();

  // Tenant created in ONBOARDING; `active` mirrors `status == ACTIVE` so
  // existing reading code treats this club as inactive until go-live.
  const tenant = await prisma.tenant.create({
    data: {
      name: app.clubName,
      slug,
      status: "ONBOARDING",
      active: false,
    },
    select: { id: true, name: true, slug: true },
  });

  // The maintenance agent is mandatory for every club (provides the
  // training data the platform's AI relies on). Provisioned on at approval
  // and locked from tenant-admin toggling — see the flags PUT route.
  await prisma.featureFlag.create({
    data: { tenantId: tenant.id, key: "agent", enabled: true },
  });
  // Bookings capability — on by default; turned off for admin-only orgs
  // (CHARITY_ADMIN vertical) when the tenant sets their vertical in the wizard.
  await prisma.featureFlag.create({
    data: { tenantId: tenant.id, key: "bookings", enabled: true },
  });

  // Placeholder password hash that cannot match any real password — user
  // sets a real one via the invitation accept flow.
  const placeholderHash = await bcrypt.hash(randomBytes(32).toString("hex"), 4);

  // If a User with this email already exists (multi-club case), reuse it
  // and just attach a new Membership; otherwise create the User too.
  let user = await prisma.user.findUnique({
    where: { email: app.contactEmail },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: app.contactEmail,
        name: app.contactName,
        passwordHash: placeholderHash,
        role: "TENANT_ADMIN", // back-compat mirror; primary membership
        tenantId: tenant.id,
      },
      select: { id: true, email: true, name: true },
    });
  }

  // Membership for this tenant (PENDING until invitation accepted).
  await prisma.membership.create({
    data: {
      userId: user.id,
      tenantId: tenant.id,
      role: "TENANT_ADMIN",
      kind: "STAFF",
      status: "PENDING",
    },
  });

  // Invitation row + token.
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000);
  const invitation = await prisma.userInvitation.create({
    data: {
      email: user.email,
      tenantId: tenant.id,
      role: "TENANT_ADMIN",
      kind: "STAFF",
      invitedById: session.user.id,
      expiresAt,
    },
    select: { id: true, token: true, expiresAt: true },
  });

  // Mark application approved + link to tenant.
  await prisma.tenantApplication.update({
    where: { id: app.id },
    data: {
      status: "APPROVED",
      decisionNotes: body.decisionNotes ?? null,
      reviewedAt: new Date(),
      reviewedById: session.user.id,
      tenantId: tenant.id,
    },
  });

  // ── Outbound stubs ──
  const baseUrl = process.env.NEXTAUTH_URL ?? "";
  const acceptUrl = `${baseUrl}/invite/${invitation.token}`;
  const decisionNotesBlock = body.decisionNotes
    ? `Notes from our team:\n${body.decisionNotes}`
    : "";

  // Approval email to applicant.
  await sendEmail({
    to: app.contactEmail,
    subject: `${app.clubName} has been approved`,
    template: "approval",
    data: {
      contactName: app.contactName,
      clubName: app.clubName,
      decisionNotesBlock,
    },
    tenantId: tenant.id,
    relatedEntity: "TenantApplication",
    relatedEntityId: app.id,
  });

  // Invitation email.
  await sendEmail({
    to: user.email,
    subject: `You've been invited to ${app.clubName}`,
    template: "invitation",
    data: {
      name: user.name ?? app.contactName,
      inviterName: "the BookingPlatform team",
      clubName: app.clubName,
      roleLabel: "Club Admin",
      acceptUrl,
      expiresAt: expiresAt.toLocaleDateString("en-GB", {
        day: "2-digit", month: "long", year: "numeric",
      }),
    },
    tenantId: tenant.id,
    relatedEntity: "UserInvitation",
    relatedEntityId: invitation.id,
  });

  // Social: tenant-joined post is deferred to go-live (no public URL yet).

  logAudit({
    session,
    action: "application.approved",
    entity: "TenantApplication",
    entityId: app.id,
    tenantId: tenant.id,
    meta: {
      clubName: app.clubName,
      slug,
      invitationId: invitation.id,
    },
  });

  return NextResponse.json({
    ok: true,
    tenantId: tenant.id,
    slug,
    invitationToken: invitation.token,
  });
}
