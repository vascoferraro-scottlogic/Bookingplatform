import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import { sendEmail, sendSocial } from "@/lib/outbound";
import { isFeatureEnabled } from "@/lib/features";

// Chapters required before go-live. Chapter 5 (greens) is excluded when the
// bookings capability flag is off — organisations with no facilities skip it.
const ALL_REQUIRED_CHAPTERS = [1, 2, 3, 4, 5, 6, 7, 8];
const BASE_REQUIRED_CHAPTERS = [1, 2, 3, 4, 6, 7, 8]; // ch5 optional without bookings

function parseCompleted(json: string): number[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed.filter((n): n is number => typeof n === "number");
    return [];
  } catch {
    return [];
  }
}

/**
 * GET /api/onboarding/go-live
 *
 * Reports whether the tenant is ready to go live, and lists any blockers.
 * Used by the wizard's Review chapter to enable/disable the button.
 */
export async function GET(_req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const tenantId = getEffective(session).tenantId;
  if (!tenantId) return jsonError("No tenant context", 400);

  const [tenant, progress, queuedInvitationCount] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, name: true, status: true, goLiveAt: true, locality: true },
    }),
    prisma.onboardingProgress.findUnique({
      where: { tenantId },
      select: { completedChapters: true, subscriptionAttestedAt: true, completedAt: true },
    }),
    prisma.userInvitation.count({ where: { tenantId, status: "QUEUED" } }),
  ]);
  if (!tenant) return jsonError("Tenant not found", 404);

  const blockers: string[] = [];
  if (tenant.status === "ACTIVE" || tenant.goLiveAt) {
    blockers.push("Already live");
  }
  if (tenant.slug.startsWith("t-")) {
    blockers.push("Pick your public URL in the About chapter");
  }
  const completed = new Set(progress ? parseCompleted(progress.completedChapters) : []);
  const bookingsOn = await isFeatureEnabled(tenantId, "bookings");
  const requiredChapters = bookingsOn ? ALL_REQUIRED_CHAPTERS : BASE_REQUIRED_CHAPTERS;
  const missing = requiredChapters.filter((n) => !completed.has(n));
  if (missing.length) {
    blockers.push(`Complete chapter${missing.length > 1 ? "s" : ""} ${missing.join(", ")}`);
  }
  if (!progress?.subscriptionAttestedAt) {
    blockers.push("Confirm your subscription");
  }

  return NextResponse.json({
    ready: blockers.length === 0,
    blockers,
    queuedInvitationCount,
    tenant: {
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      goLiveAt: tenant.goLiveAt,
    },
  });
}

/**
 * POST /api/onboarding/go-live
 *
 * Flips the tenant from ONBOARDING to ACTIVE. Locks the slug, releases all
 * QUEUED invitations to PENDING, fires their (stubbed) outbound emails,
 * and stamps `goLiveAt` + `OnboardingProgress.completedAt`. Audited as
 * `tenant.went_live`.
 */
export async function POST(_req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const tenantId = getEffective(session).tenantId;
  if (!tenantId) return jsonError("No tenant context", 400);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, slug: true, status: true, goLiveAt: true, locality: true },
  });
  if (!tenant) return jsonError("Tenant not found", 404);
  if (tenant.status === "ACTIVE" || tenant.goLiveAt) {
    return jsonError("Already live", 409);
  }
  if (tenant.slug.startsWith("t-")) {
    return jsonError("Pick a public URL in the About chapter before going live", 400);
  }

  const progress = await prisma.onboardingProgress.findUnique({
    where: { tenantId },
    select: { completedChapters: true, subscriptionAttestedAt: true },
  });
  const completed = new Set(progress ? parseCompleted(progress.completedChapters) : []);
  const bookingsOn = await isFeatureEnabled(tenantId, "bookings");
  const requiredChapters = bookingsOn ? ALL_REQUIRED_CHAPTERS : BASE_REQUIRED_CHAPTERS;
  const missing = requiredChapters.filter((n) => !completed.has(n));
  if (missing.length) {
    return jsonError(
      `Complete chapter${missing.length > 1 ? "s" : ""} ${missing.join(", ")} before going live`,
      400,
    );
  }
  if (!progress?.subscriptionAttestedAt) {
    return jsonError("Confirm your subscription before going live", 400);
  }

  // Flip status + release queued invitations in a single transaction.
  const now = new Date();
  const baseUrl = process.env.NEXTAUTH_URL ?? "";
  const queued = await prisma.userInvitation.findMany({
    where: { tenantId, status: "QUEUED" },
    select: { id: true, email: true, role: true, token: true, expiresAt: true },
  });

  await prisma.$transaction([
    prisma.tenant.update({
      where: { id: tenantId },
      data: { status: "ACTIVE", active: true, goLiveAt: now },
    }),
    prisma.userInvitation.updateMany({
      where: { tenantId, status: "QUEUED" },
      data: { status: "PENDING" },
    }),
    prisma.onboardingProgress.update({
      where: { tenantId },
      data: { completedAt: now },
    }),
  ]);

  // Fire outbound stubs after the commit (so a stub failure can't roll back
  // the status flip — go-live must be durable).
  for (const inv of queued) {
    try {
      await sendEmail({
        to: inv.email,
        subject: `You've been invited to ${tenant.name}`,
        template: "invitation",
        data: {
          recipientName: inv.email,
          tenantName: tenant.name,
          inviterName: session.user.name || session.user.email,
          acceptUrl: `${baseUrl}/invite/${inv.token}`,
          role: inv.role,
        },
        tenantId,
        relatedEntity: "UserInvitation",
        relatedEntityId: inv.id,
      });
    } catch {
      // Outbound is stubbed; failures are best-effort and recoverable.
    }
  }

  // Tenant-joined social post — deferred from approval to go-live so the
  // public URL is real by the time the post fires.
  try {
    await sendSocial({
      to: "@bookingplatform",
      socialPlatform: "FACEBOOK",
      template: "tenant-joined",
      data: {
        clubName: tenant.name,
        publicUrl: `${baseUrl}/${tenant.slug}`,
        hashtag: tenant.slug.replace(/-/g, ""),
      },
      tenantId,
      relatedEntity: "Tenant",
      relatedEntityId: tenant.id,
    });
  } catch {
    /* outbound stub is best-effort */
  }

  logAudit({
    session,
    action: "tenant.went_live",
    entity: "Tenant",
    entityId: tenantId,
    tenantId,
    meta: {
      slug: tenant.slug,
      releasedInvitations: queued.length,
    },
  });

  return NextResponse.json({
    ok: true,
    slug: tenant.slug,
    goLiveAt: now,
    releasedInvitations: queued.length,
  });
}
