import { prisma } from "@/lib/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockSessionReturn: any;

jest.mock("@/lib/api-utils", () => {
  const actual = jest.requireActual("@/lib/api-utils");
  return {
    ...actual,
    getSessionOrFail: jest.fn(() => Promise.resolve(mockSessionReturn)),
  };
});

jest.mock("@/lib/billing", () => ({
  getRevenueReport: jest.fn(() =>
    Promise.resolve({
      mrr: 50000,
      arr: 600000,
      totalRevenue: 1200000,
      outstanding: 5000,
      activeTenants: 3,
      arpt: 16667,
      byPlan: [{ planId: "p1", planName: "Pro", tenants: 3, mrr: 50000 }],
      byMonth: [{ month: "2026-04", revenue: 50000 }],
    }),
  ),
  getChurnReport: jest.fn(() =>
    Promise.resolve({
      totalChurned: 1,
      churnRate: 5,
      byMonth: [{ month: "2026-04", count: 1 }],
      churned: [],
    }),
  ),
}));

import { GET } from "@/app/api/admin/reports/insights/route";

const stamp = Date.now();

const cleanup: {
  tenantIds: string[];
  userIds: string[];
  bookingIds: string[];
  taskIds: string[];
  eventIds: string[];
  appIds: string[];
} = { tenantIds: [], userIds: [], bookingIds: [], taskIds: [], eventIds: [], appIds: [] };

let tenantId: string;
let platformAdminId: string;
let userId: string;
let rinkId: string;

function platformSession(uid: string) {
  return {
    session: {
      user: {
        id: uid,
        email: "platform-admin@test.com",
        name: "Platform Admin",
        role: "PLATFORM_ADMIN",
        tenantId: null,
        actingAs: null,
      },
    },
  };
}

function tenantSession(uid: string, tid: string) {
  return {
    session: {
      user: {
        id: uid,
        email: "tenant-admin@test.com",
        name: "Tenant Admin",
        role: "TENANT_ADMIN",
        tenantId: tid,
        actingAs: null,
      },
    },
  };
}

function impersonatingSession(uid: string) {
  return {
    session: {
      user: {
        id: uid,
        email: "platform-admin@test.com",
        name: "Platform Admin",
        role: "PLATFORM_ADMIN",
        tenantId: null,
        actingAs: { tenantId: "some-tenant", tenantName: "Fake Club" },
      },
    },
  };
}

beforeAll(async () => {
  // Create tenant
  const t = await prisma.tenant.create({
    data: {
      name: `MI Test Club ${stamp}`,
      slug: `mi-test-${stamp}`,
      status: "ACTIVE",
      active: true,
      locale: "en",
      country: "GB",
      goLiveAt: new Date(),
    },
  });
  tenantId = t.id;
  cleanup.tenantIds.push(t.id);

  const green = await prisma.green.create({
    data: { name: "Main Green", tenantId },
  });
  const rink = await prisma.rink.create({
    data: { name: "Rink 1", greenId: green.id },
  });
  rinkId = rink.id;

  // Platform admin user (no tenantId)
  const pa = await prisma.user.create({
    data: {
      email: `mi-platform-${stamp}@test.com`,
      name: "Platform Admin",
      passwordHash: "x",
      role: "PLATFORM_ADMIN",
    },
  });
  platformAdminId = pa.id;
  cleanup.userIds.push(pa.id);

  // Tenant user
  const u = await prisma.user.create({
    data: {
      email: `mi-user-${stamp}@test.com`,
      name: "Test User",
      passwordHash: "x",
      role: "USER",
      tenantId,
    },
  });
  userId = u.id;
  cleanup.userIds.push(u.id);

  // Create a booking (today)
  const todayISO = new Date().toISOString().slice(0, 10);
  const booking = await prisma.booking.create({
    data: {
      tenantId,
      userId,
      date: todayISO,
      status: "CONFIRMED",
      slots: { create: { rinkId, timeSlot: "10:00-12:00" } },
    },
  });
  cleanup.bookingIds.push(booking.id);

  // Create a maintenance task
  const task = await prisma.maintenanceTask.create({
    data: {
      tenantId,
      title: "Fix drainage",
      description: "Water pooling on green 2",
      status: "CLOSED",
      submittedById: userId,
    },
  });
  cleanup.taskIds.push(task.id);

  // Create an event
  const event = await prisma.event.create({
    data: {
      tenantId,
      title: "Summer Social",
      description: "Annual club social",
      date: todayISO,
      startTime: "18:00",
      status: "PUBLISHED",
      createdById: userId,
    },
  });
  cleanup.eventIds.push(event.id);

  // Create a tenant application
  const app = await prisma.tenantApplication.create({
    data: {
      clubName: `App Test Club ${stamp}`,
      contactName: "Test Applicant",
      contactEmail: `applicant-${stamp}@test.com`,
      country: "GB",
      status: "APPROVED",
      reviewedAt: new Date(),
    },
  });
  cleanup.appIds.push(app.id);

  // Create onboarding progress
  await prisma.onboardingProgress.create({
    data: { tenantId, currentChapter: 5, completedAt: new Date() },
  });
});

afterAll(async () => {
  // Clean up in dependency order
  await prisma.onboardingProgress.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.tenantApplication.deleteMany({ where: { id: { in: cleanup.appIds } } });
  await prisma.bookingSlot.deleteMany({
    where: { booking: { id: { in: cleanup.bookingIds } } },
  });
  await prisma.booking.deleteMany({ where: { id: { in: cleanup.bookingIds } } });
  await prisma.maintenanceTask.deleteMany({ where: { id: { in: cleanup.taskIds } } });
  await prisma.event.deleteMany({ where: { id: { in: cleanup.eventIds } } });
  await prisma.rink.deleteMany({ where: { id: rinkId } });
  await prisma.green.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: cleanup.tenantIds } } });
  await prisma.$disconnect();
});

describe("GET /api/admin/reports/insights", () => {
  // ── Auth ──

  it("rejects unauthenticated requests", async () => {
    mockSessionReturn = { session: null, error: new Response("Unauthorized", { status: 401 }) };
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("rejects TENANT_ADMIN role", async () => {
    mockSessionReturn = tenantSession(userId, tenantId);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("rejects impersonating PLATFORM_ADMIN", async () => {
    mockSessionReturn = impersonatingSession(platformAdminId);
    const res = await GET();
    expect(res.status).toBe(409);
  });

  // ── Happy path ──

  it("returns all 9 domains for PLATFORM_ADMIN", async () => {
    mockSessionReturn = platformSession(platformAdminId);
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.generatedAt).toBeDefined();
    expect(body.period).toBe("30d");

    // Domain 1: Adoption
    expect(body.adoption).toBeDefined();
    expect(body.adoption.totalTenants).toBeGreaterThanOrEqual(1);
    expect(body.adoption.activeTenants).toBeGreaterThanOrEqual(1);
    expect(body.adoption.totalUsers).toBeGreaterThanOrEqual(2);

    // Domain 2: Revenue (mocked)
    expect(body.revenue.mrr).toBe(50000);
    expect(body.revenue.arr).toBe(600000);
    expect(body.revenue.byCountry).toBeDefined();

    // Domain 3: Churn (mocked)
    expect(body.churn.totalChurned).toBe(1);
    expect(body.churn.churnRate).toBe(5);

    // Domain 4: Operations
    expect(body.operations.bookings30d).toBeGreaterThanOrEqual(1);
    expect(body.operations.confirmed30d).toBeGreaterThanOrEqual(1);
    expect(body.operations.taskCompletionRate).toBeGreaterThanOrEqual(0);
    expect(body.operations.tenantLeaderboard).toBeDefined();

    // Domain 5: Agents
    expect(body.agents).toBeDefined();
    expect(body.agents.detector).toBeDefined();

    // Domain 6: Federation & funding
    expect(body.federationAndFunding).toBeDefined();

    // Domain 7: Onboarding pipeline
    expect(body.onboardingPipeline).toBeDefined();
    expect(body.onboardingPipeline.totalApplications).toBeGreaterThanOrEqual(1);
    expect(body.onboardingPipeline.totalActivated).toBeGreaterThanOrEqual(1);

    // Domain 8: Language
    expect(body.language).toBeDefined();
    expect(body.language.tenantsByLocale).toBeDefined();
    expect(body.language.tenantsByCountry).toBeDefined();

    // Domain 9: Feature usage
    expect(body.featureUsage).toBeDefined();
    expect(body.featureUsage.topFeatures30d).toBeDefined();
  });

  it("returns onboarding pipeline with activation times", async () => {
    mockSessionReturn = platformSession(platformAdminId);
    const res = await GET();
    const body = await res.json();

    // Our test tenant has goLiveAt = now, createdAt ≈ now, so avgActivationDays should be 0
    expect(body.onboardingPipeline.avgActivationDays).toBeDefined();
    expect(body.onboardingPipeline.medianActivationDays).toBeDefined();
    expect(body.onboardingPipeline.activationByCountry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ country: "GB" }),
      ]),
    );
  });

  it("returns language distribution", async () => {
    mockSessionReturn = platformSession(platformAdminId);
    const res = await GET();
    const body = await res.json();

    // Our test tenant has locale "en"
    const enLocale = body.language.tenantsByLocale.find(
      (l: { locale: string }) => l.locale === "en",
    );
    expect(enLocale).toBeDefined();
    expect(enLocale.count).toBeGreaterThanOrEqual(1);

    const gbCountry = body.language.tenantsByCountry.find(
      (c: { country: string }) => c.country === "GB",
    );
    expect(gbCountry).toBeDefined();
    expect(gbCountry.count).toBeGreaterThanOrEqual(1);
  });

  it("returns operations with at least our test data", async () => {
    mockSessionReturn = platformSession(platformAdminId);
    const res = await GET();
    const body = await res.json();

    expect(body.operations.bookings30d).toBeGreaterThanOrEqual(1);
    expect(body.operations.tasks30d).toBeGreaterThanOrEqual(1);
    expect(body.operations.tasksClosed30d).toBeGreaterThanOrEqual(1);
    expect(body.operations.events30d).toBeGreaterThanOrEqual(1);
    expect(body.operations.eventsPublished30d).toBeGreaterThanOrEqual(1);
  });

  it("returns application pipeline stats", async () => {
    mockSessionReturn = platformSession(platformAdminId);
    const res = await GET();
    const body = await res.json();

    expect(body.onboardingPipeline.applicationsByStatus).toBeDefined();
    expect(body.onboardingPipeline.applicationsByStatus.APPROVED).toBeGreaterThanOrEqual(1);
  });
});
