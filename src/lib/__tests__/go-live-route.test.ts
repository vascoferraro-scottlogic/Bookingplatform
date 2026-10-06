import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

let mockSessionReturn: any;

jest.mock("@/lib/api-utils", () => {
  const actual = jest.requireActual("@/lib/api-utils");
  return {
    ...actual,
    getSessionOrFail: jest.fn(() => Promise.resolve(mockSessionReturn)),
  };
});

import { GET, POST } from "@/app/api/onboarding/go-live/route";

let tenantId: string;
let tenantAdminId: string;
const cleanup: { tenantIds: string[]; userIds: string[] } = { tenantIds: [], userIds: [] };

function adminSession() {
  return {
    session: {
      user: {
        id: tenantAdminId,
        email: "gl-admin@test.com",
        name: "GL Admin",
        role: "TENANT_ADMIN",
        tenantId,
        actingAs: null,
      },
    },
  };
}

const ALL_REQUIRED = JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]);

async function resetTenantToOnboardingWithRealSlug() {
  const stamp = Date.now();
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { status: "ONBOARDING", active: false, goLiveAt: null, slug: `gl-real-${stamp}` },
  });
}

async function setProgress(opts: { completedChapters?: string; subscriptionAttestedAt?: Date | null }) {
  const data = {
    completedChapters: opts.completedChapters ?? "[]",
    subscriptionAttestedAt: opts.subscriptionAttestedAt ?? null,
  };
  await prisma.onboardingProgress.upsert({
    where: { tenantId },
    update: { ...data, completedAt: null },
    create: { tenantId, currentChapter: 1, ...data },
  });
}

beforeAll(async () => {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: { name: "GL Test Club", slug: `t-${stamp.toString(16).slice(-8)}`, status: "ONBOARDING", active: false },
  });
  tenantId = tenant.id;
  cleanup.tenantIds.push(tenant.id);

  const admin = await prisma.user.create({
    data: { email: `gl-admin-${stamp}@test.com`, name: "GL Admin", passwordHash: "x", role: "TENANT_ADMIN", tenantId },
  });
  tenantAdminId = admin.id;
  cleanup.userIds.push(admin.id);
});

afterAll(async () => {
  await prisma.userInvitation.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.outboundMessage.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: cleanup.userIds } } });
  await prisma.onboardingProgress.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.user.updateMany({ where: { tenantId: { in: cleanup.tenantIds } }, data: { tenantId: null } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: cleanup.tenantIds } } });
  await prisma.$disconnect();
});

describe("/api/onboarding/go-live", () => {
  beforeEach(() => {
    mockSessionReturn = adminSession();
  });

  describe("GET (readiness)", () => {
    test("reports placeholder-slug as a blocker", async () => {
      const stamp = Date.now();
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { status: "ONBOARDING", active: false, goLiveAt: null, slug: `t-${stamp.toString(16).slice(-8)}` },
      });
      await setProgress({ completedChapters: ALL_REQUIRED, subscriptionAttestedAt: new Date() });

      const res = await GET(new NextRequest("http://localhost/api/onboarding/go-live"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ready).toBe(false);
      expect(body.blockers.some((b: string) => /public URL/i.test(b))).toBe(true);
    });

    test("reports missing chapters and missing subscription as blockers", async () => {
      await resetTenantToOnboardingWithRealSlug();
      await setProgress({ completedChapters: JSON.stringify([1, 2]), subscriptionAttestedAt: null });

      const res = await GET(new NextRequest("http://localhost/api/onboarding/go-live"));
      const body = await res.json();
      expect(body.ready).toBe(false);
      expect(body.blockers.some((b: string) => /chapter/i.test(b))).toBe(true);
      expect(body.blockers.some((b: string) => /subscription/i.test(b))).toBe(true);
    });

    test("reports ready when all prereqs met", async () => {
      await resetTenantToOnboardingWithRealSlug();
      await setProgress({ completedChapters: ALL_REQUIRED, subscriptionAttestedAt: new Date() });

      const res = await GET(new NextRequest("http://localhost/api/onboarding/go-live"));
      const body = await res.json();
      expect(body.ready).toBe(true);
      expect(body.blockers).toEqual([]);
    });

    test("counts queued invitations", async () => {
      await resetTenantToOnboardingWithRealSlug();
      await setProgress({ completedChapters: ALL_REQUIRED, subscriptionAttestedAt: new Date() });
      await prisma.userInvitation.deleteMany({ where: { tenantId } });
      const stamp = Date.now();
      await prisma.userInvitation.createMany({
        data: [
          {
            tenantId,
            email: `q1-${stamp}@test.com`,
            role: "USER",
            token: `tok-q1-${stamp}`,
            status: "QUEUED",
            invitedById: tenantAdminId,
            expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          },
          {
            tenantId,
            email: `q2-${stamp}@test.com`,
            role: "USER",
            token: `tok-q2-${stamp}`,
            status: "QUEUED",
            invitedById: tenantAdminId,
            expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          },
        ],
      });

      const res = await GET(new NextRequest("http://localhost/api/onboarding/go-live"));
      const body = await res.json();
      expect(body.queuedInvitationCount).toBe(2);
    });
  });

  describe("POST (flip)", () => {
    test("blocks when prereqs unmet", async () => {
      await resetTenantToOnboardingWithRealSlug();
      await setProgress({ completedChapters: JSON.stringify([1]), subscriptionAttestedAt: null });

      const res = await POST(new NextRequest("http://localhost/api/onboarding/go-live", { method: "POST" }));
      expect(res.status).toBe(400);

      const refreshed = await prisma.tenant.findUnique({ where: { id: tenantId } });
      expect(refreshed?.status).toBe("ONBOARDING");
      expect(refreshed?.goLiveAt).toBeNull();
    });

    test("blocks when slug is still a placeholder", async () => {
      const stamp = Date.now();
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { status: "ONBOARDING", active: false, goLiveAt: null, slug: `t-${stamp.toString(16).slice(-8)}` },
      });
      await setProgress({ completedChapters: ALL_REQUIRED, subscriptionAttestedAt: new Date() });

      const res = await POST(new NextRequest("http://localhost/api/onboarding/go-live", { method: "POST" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/public URL/i);
    });

    test("flips status, releases QUEUED invitations, fires outbound, audits", async () => {
      await resetTenantToOnboardingWithRealSlug();
      await setProgress({ completedChapters: ALL_REQUIRED, subscriptionAttestedAt: new Date() });
      await prisma.userInvitation.deleteMany({ where: { tenantId } });
      await prisma.outboundMessage.deleteMany({ where: { tenantId } });
      await prisma.auditEvent.deleteMany({ where: { tenantId } });

      const stamp = Date.now();
      await prisma.userInvitation.create({
        data: {
          tenantId,
          email: `release-${stamp}@test.com`,
          role: "USER",
          token: `tok-release-${stamp}`,
          status: "QUEUED",
          invitedById: tenantAdminId,
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
      });

      const res = await POST(new NextRequest("http://localhost/api/onboarding/go-live", { method: "POST" }));
      expect(res.status).toBe(200);

      const refreshed = await prisma.tenant.findUnique({ where: { id: tenantId } });
      expect(refreshed?.status).toBe("ACTIVE");
      expect(refreshed?.active).toBe(true);
      expect(refreshed?.goLiveAt).toBeTruthy();

      const released = await prisma.userInvitation.findMany({ where: { tenantId } });
      expect(released.every((i) => i.status === "PENDING")).toBe(true);

      // Give async after-commit outbound + audit a tick.
      await new Promise((r) => setTimeout(r, 100));

      const outbound = await prisma.outboundMessage.findMany({ where: { tenantId } });
      // At least one invitation email + one tenant-joined social post.
      expect(outbound.length).toBeGreaterThanOrEqual(1);

      const audits = await prisma.auditEvent.findMany({ where: { tenantId, action: "tenant.went_live" } });
      expect(audits.length).toBeGreaterThanOrEqual(1);

      const progress = await prisma.onboardingProgress.findUnique({ where: { tenantId } });
      expect(progress?.completedAt).toBeTruthy();
    });

    test("rejects re-going-live (already live)", async () => {
      // tenant is now ACTIVE from previous test
      const res = await POST(new NextRequest("http://localhost/api/onboarding/go-live", { method: "POST" }));
      expect(res.status).toBe(409);
    });
  });
});
