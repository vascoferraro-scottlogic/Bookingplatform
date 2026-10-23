jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

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
      byMonth: [{ month: "m1", revenue: 50000 }],
    }),
  ),
  getChurnReport: jest.fn(() =>
    Promise.resolve({
      totalChurned: 1,
      churnRate: 5,
      byMonth: [{ month: "m1", count: 1 }],
      churned: [],
    }),
  ),
}));

// The raw counts (tenants, bookings, runs, …) come from Prisma count/groupBy
// and SQL and are only passed through, so these tests feed fixed counts and
// check the guards, the derived KPIs the route computes in JavaScript (rates,
// onboarding progress, activation and review times, per-country rollups,
// agent-name lookup, detector conversion) and the response shape.

import { prismaMock } from "@/test-utils/prisma-mock";

// groupBy is a heavily overloaded generic, so its deep mock is untyped; cast it.
const groupByMock = (model: { groupBy: unknown }) => model.groupBy as unknown as jest.Mock;
import { signInAs } from "@/test-utils/session";
import { readJson } from "@/test-utils/http";
import { hoursFromNow } from "@/test-utils/dates";
import { GET } from "@/app/api/admin/reports/insights/route";

const PLATFORM_ADMIN_ID = "platform-admin";
const daysAgo = (days: number) => hoursFromNow(-24 * days);

const signInAsPlatformAdmin = () => signInAs({ id: PLATFORM_ADMIN_ID, role: "PLATFORM_ADMIN", tenantId: null });

/** Each count resolves to a value chosen by its `where` (default 0). */
function countBy(model: { count: jest.Mock }, pick: (where: any) => number) {
  model.count.mockImplementation((async (args?: any) => pick(args?.where ?? {})) as never);
}

/** Raw queries answered by recognising their SQL (default: no rows). */
function givenRawRows(rows: { leaderboard?: unknown[]; revenueByCountry?: unknown[]; featureByCountry?: unknown[]; featureByTenant?: unknown[] }) {
  prismaMock.$queryRawUnsafe.mockImplementation((async (sql: string) => {
    if (sql.includes('FROM "Booking"')) return rows.leaderboard ?? [];
    if (sql.includes("TenantBillingProfile")) return rows.revenueByCountry ?? [];
    if (sql.includes("GROUP BY t.country, te.action")) return rows.featureByCountry ?? [];
    if (sql.includes("GROUP BY t.id")) return rows.featureByTenant ?? [];
    throw new Error(`unexpected query: ${sql}`);
  }) as never);
}

beforeEach(() => {
  // Empty platform: every count 0, every list empty.
  for (const model of ["tenant", "user", "booking", "maintenanceTask", "event", "agentRun", "agentProposal", "federation", "fundingApplication"] as const) {
    (prismaMock[model].count as jest.Mock).mockResolvedValue(0);
  }
  for (const model of ["tenant", "agentRun", "fundingApplication", "trackingEvent"] as const) {
    (prismaMock[model].groupBy as jest.Mock).mockResolvedValue([]);
  }
  prismaMock.onboardingProgress.findMany.mockResolvedValue([]);
  prismaMock.tenant.findMany.mockResolvedValue([]);
  prismaMock.tenantApplication.findMany.mockResolvedValue([]);
  prismaMock.agentRun.aggregate.mockResolvedValue({ _sum: { costsCents: null, tokensIn: null, tokensOut: null } } as never);
  prismaMock.agentDefinition.findUnique.mockResolvedValue(null);
  prismaMock.agentDefinition.findMany.mockResolvedValue([]);
  givenRawRows({});
});

describe("GET /api/admin/reports/insights", () => {
  // ── Auth ──

  it("rejects unauthenticated requests", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("rejects TENANT_ADMIN role", async () => {
    signInAs({ id: "tenant-admin", role: "TENANT_ADMIN", tenantId: "tenant-1" });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(prismaMock.tenant.count).not.toHaveBeenCalled();
  });

  it("rejects impersonating PLATFORM_ADMIN", async () => {
    signInAs({
      id: PLATFORM_ADMIN_ID,
      role: "PLATFORM_ADMIN",
      tenantId: null,
      actingAs: { tenantId: "some-tenant", tenantName: "Fake Club", role: "TENANT_ADMIN", impersonationId: "imp-1", startedAt: new Date().toISOString() },
    });
    const { status, body } = await readJson(await GET());
    expect(status).toBe(409);
    expect(body.error).toBe("EXIT_IMPERSONATION_REQUIRED");
    expect(prismaMock.tenant.count).not.toHaveBeenCalled();
  });

  // ── Happy path ──

  it("returns all 9 domains for PLATFORM_ADMIN", async () => {
    signInAsPlatformAdmin();
    const { status, body } = await readJson(await GET());

    expect(status).toBe(200);
    expect(body.generatedAt).toBeDefined();
    expect(body.period).toBe("30d");
    for (const domain of ["adoption", "revenue", "churn", "operations", "agents", "federationAndFunding", "onboardingPipeline", "language", "featureUsage"]) {
      expect(body[domain]).toBeDefined();
    }
    expect(body.agents.detector).toBeDefined();
    expect(body.language.tenantsByLocale).toBeDefined();
    expect(body.language.tenantsByCountry).toBeDefined();
    expect(body.featureUsage.topFeatures30d).toBeDefined();
    expect(body.operations.tenantLeaderboard).toBeDefined();
  });

  it("passes the revenue and churn reports through, plus revenue by country", async () => {
    signInAsPlatformAdmin();
    givenRawRows({ revenueByCountry: [{ country: "GB", tenant_count: BigInt(3), mrr_pence: BigInt(50000) }] });

    const { body } = await readJson(await GET());

    expect(body.revenue.mrr).toBe(50000);
    expect(body.revenue.arr).toBe(600000);
    expect(body.revenue.byCountry).toEqual([{ country: "GB", tenants: 3, mrrPence: 50000 }]);
    expect(body.churn.totalChurned).toBe(1);
    expect(body.churn.churnRate).toBe(5);
  });

  it("returns adoption counts and onboarding progress", async () => {
    signInAsPlatformAdmin();
    countBy(prismaMock.tenant as never, (w) => (w.status === "ACTIVE" ? 2 : w.status === "ONBOARDING" ? 2 : w.goLiveAt ? 1 : 4));
    countBy(prismaMock.user as never, (w) => (w.createdAt ? 1 : 5));
    prismaMock.onboardingProgress.findMany.mockResolvedValue([
      { completedAt: daysAgo(1), currentChapter: 5 },
      { completedAt: null, currentChapter: 2 },
      { completedAt: null, currentChapter: 3 },
    ] as never);

    const { body } = await readJson(await GET());

    expect(body.adoption).toEqual({
      totalTenants: 4,
      activeTenants: 2,
      onboardingTenants: 2,
      totalUsers: 5,
      newUsers30d: 1,
      tenantsGoneLive30d: 1,
      onboardingCompleted: 1,
      onboardingInProgress: 2,
      avgOnboardingChapter: 2.5,
    });
  });

  it("returns operations with derived rates and the booking leaderboard", async () => {
    signInAsPlatformAdmin();
    countBy(prismaMock.booking as never, (w) => (w.status === "CONFIRMED" ? 2 : w.status === "CANCELLED" ? 1 : 3));
    countBy(prismaMock.maintenanceTask as never, (w) => (w.status === "CLOSED" ? 1 : 3));
    countBy(prismaMock.event as never, (w) => (w.status === "PUBLISHED" ? 1 : 2));
    givenRawRows({ leaderboard: [{ tenant_id: "t1", tenant_name: "Club One", count: BigInt(3) }] });

    const { body } = await readJson(await GET());

    expect(body.operations).toEqual({
      bookings30d: 3,
      confirmed30d: 2,
      cancelled30d: 1,
      confirmRate: 67,
      cancelRate: 33,
      tasks30d: 3,
      tasksClosed30d: 1,
      taskCompletionRate: 33,
      events30d: 2,
      eventsPublished30d: 1,
      tenantLeaderboard: [{ tenantId: "t1", tenantName: "Club One", bookings: 3 }],
    });
  });

  it("rates are 0 rather than NaN on an empty platform", async () => {
    signInAsPlatformAdmin();
    const { body } = await readJson(await GET());

    expect(body.operations.confirmRate).toBe(0);
    expect(body.operations.cancelRate).toBe(0);
    expect(body.operations.taskCompletionRate).toBe(0);
    expect(body.agents.successRate).toBe(0);
    expect(body.agents.approvalRate).toBe(0);
    expect(body.agents.detector.approvalRate).toBe(0);
    expect(body.agents.spend30d).toBe(0);
    expect(body.onboardingPipeline.avgActivationDays).toBeNull();
    expect(body.onboardingPipeline.medianActivationDays).toBeNull();
    expect(body.onboardingPipeline.avgReviewDays).toBeNull();
  });

  it("returns agent effectiveness with agent names resolved", async () => {
    signInAsPlatformAdmin();
    countBy(prismaMock.agentRun as never, (w) => (w.status === "COMPLETED" ? 3 : w.status === "FAILED" ? 1 : 4));
    countBy(prismaMock.agentProposal as never, (w) => (w.status === "APPROVED" ? 1 : w.status === "REJECTED" ? 1 : 4));
    prismaMock.agentRun.aggregate.mockResolvedValue({ _sum: { costsCents: 120, tokensIn: 1000, tokensOut: 500 } } as never);
    groupByMock(prismaMock.agentRun).mockResolvedValue([
      { agentId: "a1", _sum: { costsCents: 100 }, _count: 3 },
      { agentId: "a-unknown", _sum: { costsCents: null }, _count: 1 },
    ] as never);
    prismaMock.agentDefinition.findMany.mockResolvedValue([{ id: "a1", name: "No-show agent" }] as never);

    const { body } = await readJson(await GET());

    expect(prismaMock.agentDefinition.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["a1", "a-unknown"] } },
      select: { id: true, name: true },
    });
    expect(body.agents).toMatchObject({
      runs30d: 4,
      successful30d: 3,
      failed30d: 1,
      successRate: 75,
      proposals30d: 4,
      approved30d: 1,
      rejected30d: 1,
      approvalRate: 25,
      spend30d: 120,
      tokensIn30d: 1000,
      tokensOut30d: 500,
      byAgent: [
        { agentId: "a1", agentName: "No-show agent", runs: 3, spend: 100 },
        { agentId: "a-unknown", agentName: "a-unknown", runs: 1, spend: 0 },
      ],
    });
  });

  it("detector conversion is counted only when a detector agent exists", async () => {
    signInAsPlatformAdmin();
    prismaMock.agentDefinition.findUnique.mockResolvedValue({ id: "det" } as never);
    countBy(prismaMock.agentRun as never, (w) => (w.agentId === "det" ? 5 : 0));
    countBy(prismaMock.agentProposal as never, (w) =>
      w.agentId === "det" ? (w.status === "APPROVED" ? 1 : 4) : 0);

    const { body } = await readJson(await GET());

    expect(prismaMock.agentDefinition.findUnique).toHaveBeenCalledWith({ where: { slug: "detector" }, select: { id: true } });
    expect(prismaMock.agentProposal.count).toHaveBeenCalledWith({
      where: { agentId: "det", kind: "MAINTENANCE_TASK_CREATE", createdAt: { gte: expect.any(Date) } },
    });
    expect(body.agents.detector).toEqual({ runs30d: 5, taskProposals30d: 4, tasksApproved30d: 1, approvalRate: 25 });
  });

  it("returns federation and funding counts", async () => {
    signInAsPlatformAdmin();
    countBy(prismaMock.federation as never, (w) => (w.status === "ACTIVE" ? 1 : 2));
    prismaMock.fundingApplication.count.mockResolvedValue(3 as never);
    groupByMock(prismaMock.fundingApplication).mockResolvedValue([{ status: "SUBMITTED", _count: 3 }] as never);

    const { body } = await readJson(await GET());

    expect(body.federationAndFunding).toEqual({
      totalFederations: 2,
      activeFederations: 1,
      totalFundingApplications: 3,
      fundingByStatus: [{ status: "SUBMITTED", count: 3 }],
    });
  });

  it("returns onboarding pipeline with activation times", async () => {
    signInAsPlatformAdmin();
    // Go-live 0, 2, 10 and 20 days after creation.
    prismaMock.tenant.findMany.mockResolvedValue([
      { createdAt: daysAgo(1), goLiveAt: daysAgo(1), country: "GB" },
      { createdAt: daysAgo(12), goLiveAt: daysAgo(10), country: "GB" },
      { createdAt: daysAgo(30), goLiveAt: daysAgo(20), country: "IE" },
      { createdAt: daysAgo(40), goLiveAt: daysAgo(20), country: "IE" },
    ] as never);

    const { body } = await readJson(await GET());

    expect(prismaMock.tenant.findMany).toHaveBeenCalledWith({
      where: { goLiveAt: { not: null } },
      select: { createdAt: true, goLiveAt: true, country: true },
    });
    expect(body.onboardingPipeline.totalActivated).toBe(4);
    expect(body.onboardingPipeline.avgActivationDays).toBe(8); // (0+2+10+20)/4
    expect(body.onboardingPipeline.medianActivationDays).toBe(6); // (2+10)/2
    expect(body.onboardingPipeline.activationByCountry).toEqual([
      { country: "GB", count: 2, avgDays: 1 },
      { country: "IE", count: 2, avgDays: 15 },
    ]);
  });

  it("median activation time with an odd number of tenants is the middle value", async () => {
    signInAsPlatformAdmin();
    prismaMock.tenant.findMany.mockResolvedValue([
      { createdAt: daysAgo(30), goLiveAt: daysAgo(0), country: "GB" },
      { createdAt: daysAgo(3), goLiveAt: daysAgo(0), country: "GB" },
      { createdAt: daysAgo(5), goLiveAt: daysAgo(0), country: "GB" },
    ] as never);

    const { body } = await readJson(await GET());

    expect(body.onboardingPipeline.medianActivationDays).toBe(5);
  });

  it("returns application pipeline stats", async () => {
    signInAsPlatformAdmin();
    prismaMock.tenantApplication.findMany.mockResolvedValue([
      { status: "APPROVED", createdAt: daysAgo(5), reviewedAt: daysAgo(1), tenantId: "t1" },
      { status: "APPROVED", createdAt: daysAgo(4), reviewedAt: daysAgo(2), tenantId: "t2" },
      { status: "PENDING", createdAt: daysAgo(1), reviewedAt: null, tenantId: null },
    ] as never);

    const { body } = await readJson(await GET());

    expect(body.onboardingPipeline.totalApplications).toBe(3);
    expect(body.onboardingPipeline.applicationsByStatus).toEqual({ APPROVED: 2, PENDING: 1 });
    expect(body.onboardingPipeline.avgReviewDays).toBe(3); // (4+2)/2, unreviewed excluded
  });

  it("returns language distribution for live and onboarding tenants", async () => {
    signInAsPlatformAdmin();
    groupByMock(prismaMock.tenant).mockImplementation((async ({ by }: any) =>
      by[0] === "locale" ? [{ locale: "en", _count: 2 }, { locale: "cy", _count: 1 }] : [{ country: "GB", _count: 3 }]) as never);

    const { body } = await readJson(await GET());

    expect(body.language.tenantsByLocale).toEqual([{ locale: "en", count: 2 }, { locale: "cy", count: 1 }]);
    expect(body.language.tenantsByCountry).toEqual([{ country: "GB", count: 3 }]);
    for (const [args] of groupByMock(prismaMock.tenant).mock.calls) {
      expect((args as any).where).toEqual({ status: { in: ["ACTIVE", "ONBOARDING"] } });
    }
  });

  it("returns feature usage overall, by country and by tenant", async () => {
    signInAsPlatformAdmin();
    groupByMock(prismaMock.trackingEvent).mockResolvedValue([
      { action: "booking.create", _count: 7 },
      { action: null, _count: 2 },
    ] as never);
    givenRawRows({
      featureByCountry: [{ country: "GB", action: "booking.create", count: BigInt(7) }],
      featureByTenant: [{ tenant_id: "t1", tenant_name: "Club One", locale: "en", country: "GB", count: BigInt(9) }],
    });

    const { body } = await readJson(await GET());

    expect(body.featureUsage).toEqual({
      topFeatures30d: [{ action: "booking.create", count: 7 }, { action: "unknown", count: 2 }],
      byCountry: [{ country: "GB", action: "booking.create", count: 7 }],
      byTenant: [{ tenantId: "t1", tenantName: "Club One", locale: "en", country: "GB", featureUses: 9 }],
    });
  });
});
