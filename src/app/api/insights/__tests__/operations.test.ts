jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

// Task and event counts, the category/priority breakdowns and the average
// time-to-close are computed by Prisma count/groupBy and SQL, so a mock cannot
// check them — that needs a real database (API test suite). These unit tests
// cover what the route does in JavaScript: the auth/role/flag guards, the
// tenant scoping and period window of every query, the completion-rate and
// average-days rounding, and the shape of the response.

import { prismaMock } from "@/test-utils/prisma-mock";

// groupBy is a heavily overloaded generic, so its deep mock is untyped; cast it.
const groupByMock = (model: { groupBy: unknown }) => model.groupBy as unknown as jest.Mock;
import { signInAs } from "@/test-utils/session";
import { request, readJson } from "@/test-utils/http";
import { isoDateFromToday } from "@/test-utils/dates";
import { GET } from "@/app/api/insights/operations/route";

const TENANT_ID = "tenant-1";

const getOperations = (params?: Record<string, string>) =>
  GET(request(`/api/insights/operations?${new URLSearchParams(params).toString()}`));

const signInAsAdmin = (tenantId = TENANT_ID) => signInAs({ id: "ops-admin", role: "TENANT_ADMIN", tenantId });

type Fixture = {
  totalTasks?: number;
  closedTasks?: number;
  avgDays?: number;
  totalEvents?: number;
  publishedEvents?: number;
  upcomingEvents?: number;
};

function givenStats(f: Fixture = {}) {
  prismaMock.maintenanceTask.count.mockImplementation((async ({ where }: any) =>
    where.status === "CLOSED" ? (f.closedTasks ?? 0) : (f.totalTasks ?? 0)) as never);
  prismaMock.event.count.mockImplementation((async ({ where }: any) => {
    if (where.status !== "PUBLISHED") return f.totalEvents ?? 0;
    // "Upcoming" is the published count from today onwards.
    return where.date.gte === isoDateFromToday(0) ? (f.upcomingEvents ?? 0) : (f.publishedEvents ?? 0);
  }) as never);
  prismaMock.$queryRawUnsafe.mockResolvedValue([{ avg_days: f.avgDays ?? 0 }] as never);
}

beforeEach(() => {
  prismaMock.featureFlag.findUnique.mockResolvedValue({ enabled: true } as never);
  groupByMock(prismaMock.maintenanceTask).mockResolvedValue([] as never);
  groupByMock(prismaMock.event).mockResolvedValue([] as never);
  givenStats();
});

describe("/api/insights/operations", () => {
  test("returns 401 when not authenticated", async () => {
    const res = await getOperations();
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-admin user", async () => {
    signInAs({ id: "member", role: "USER", tenantId: TENANT_ID });
    const res = await getOperations();
    expect(res.status).toBe(403);
    expect(prismaMock.maintenanceTask.count).not.toHaveBeenCalled();
  });

  test("returns 403 when the businessInsights flag is off for the tenant", async () => {
    signInAsAdmin();
    prismaMock.featureFlag.findUnique.mockResolvedValue(null);

    const { status, body } = await readJson(await getOperations());

    expect(status).toBe(403);
    expect(body.error).toBe("Feature not enabled");
    expect(prismaMock.maintenanceTask.count).not.toHaveBeenCalled();
  });

  test("returns task stats", async () => {
    signInAsAdmin();
    givenStats({ totalTasks: 3, closedTasks: 2, avgDays: 1.26 });

    const { status, body } = await readJson(await getOperations());

    expect(status).toBe(200);
    expect(body.period).toBe("30d");
    expect(body.tasks.total).toBe(3);
    expect(body.tasks.closed).toBe(2);
    expect(body.tasks.completionRate).toBe(67); // 2/3
    expect(body.tasks.avgDaysToClose).toBe(1.3); // one decimal place
  });

  test("completion rate is 0 when there are no tasks", async () => {
    signInAsAdmin();
    givenStats({ totalTasks: 0, closedTasks: 0 });
    prismaMock.$queryRawUnsafe.mockResolvedValue([] as never);

    const { body } = await readJson(await getOperations());

    expect(body.tasks.completionRate).toBe(0);
    expect(body.tasks.avgDaysToClose).toBe(0);
  });

  test("returns tasks by category and priority", async () => {
    signInAsAdmin();
    groupByMock(prismaMock.maintenanceTask).mockImplementation((async ({ by }: any) =>
      by[0] === "category"
        ? [{ category: "GENERAL", _count: 1 }, { category: "RINK_SURFACE", _count: 1 }, { category: "SAFETY", _count: 1 }]
        : [{ priority: "HIGH", _count: 1 }, { priority: "MEDIUM", _count: 1 }, { priority: "URGENT", _count: 1 }]) as never);

    const { body } = await readJson(await getOperations());

    expect(body.tasks.byCategory).toEqual([
      { category: "GENERAL", count: 1 },
      { category: "RINK_SURFACE", count: 1 },
      { category: "SAFETY", count: 1 },
    ]);
    expect(body.tasks.byPriority).toEqual([
      { priority: "HIGH", count: 1 },
      { priority: "MEDIUM", count: 1 },
      { priority: "URGENT", count: 1 },
    ]);
  });

  test("returns event stats", async () => {
    signInAsAdmin();
    givenStats({ totalEvents: 3, publishedEvents: 2, upcomingEvents: 1 });

    const { body } = await readJson(await getOperations());

    expect(body.events.total).toBe(3);
    expect(body.events.published).toBe(2);
    expect(body.events.upcoming).toBe(1);
  });

  test("upcoming events are published events dated today or later", async () => {
    signInAsAdmin();
    await getOperations();

    expect(prismaMock.event.count).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, date: { gte: isoDateFromToday(0) }, status: "PUBLISHED" },
    });
  });

  test("returns events by category", async () => {
    signInAsAdmin();
    groupByMock(prismaMock.event).mockResolvedValue([
      { category: "OPEN_DAY", _count: 1 },
      { category: "LEAGUE", _count: 1 },
      { category: "TOURNAMENT", _count: 1 },
    ] as never);

    const { body } = await readJson(await getOperations());

    expect(body.events.byCategory.map((c: any) => c.category)).toEqual(["OPEN_DAY", "LEAGUE", "TOURNAMENT"]);
  });

  test.each([
    ["30d", 30],
    ["90d", 90],
    ["7d", 7],
  ])("period=%s scopes task and event queries to the last %i days", async (period, days) => {
    signInAsAdmin();
    await getOperations({ period });

    const sinceISO = isoDateFromToday(-days);
    for (const [args] of prismaMock.maintenanceTask.count.mock.calls) {
      const since: Date = (args as any).where.createdAt.gte;
      // `since` is "now minus N days" in local time; its UTC date can be either side of midnight.
      expect([isoDateFromToday(-days - 1), sinceISO, isoDateFromToday(-days + 1)]).toContain(since.toISOString().slice(0, 10));
    }
    const eventWindows = prismaMock.event.count.mock.calls
      .map(([a]) => (a as any).where.date.gte)
      .filter((d: string) => d !== isoDateFromToday(0));
    expect(eventWindows).toHaveLength(2);
    for (const d of eventWindows) {
      expect([isoDateFromToday(-days - 1), sinceISO, isoDateFromToday(-days + 1)]).toContain(d);
    }
  });

  test("scopes every query to the caller's tenant", async () => {
    signInAsAdmin("tenant-2");
    await getOperations();

    const whereClauses = [
      ...prismaMock.maintenanceTask.count.mock.calls,
      ...groupByMock(prismaMock.maintenanceTask).mock.calls,
      ...prismaMock.event.count.mock.calls,
      ...groupByMock(prismaMock.event).mock.calls,
    ].map(([a]) => (a as any).where);
    expect(whereClauses).toHaveLength(8);
    for (const where of whereClauses) expect(where.tenantId).toBe("tenant-2");

    const [sql, firstParam] = prismaMock.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('"tenantId" = $1');
    expect(firstParam).toBe("tenant-2");
  });
});
