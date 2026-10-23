// The aggregations behind /api/insights/bookings run in SQL ($queryRawUnsafe)
// and Prisma count queries, so a mocked client cannot check that the numbers
// are right — that needs an integration test against a real database. These
// unit tests cover what the route itself does: auth, role and flag guards,
// period handling, tenant scoping of every query, the cancellation-rate
// calculation, and the mapping of raw rows (bigint -> number, column names).
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { readJson, request } from "@/test-utils/http";
import { dateFromToday, isoDateFromToday } from "@/test-utils/dates";
import { GET } from "@/app/api/insights/bookings/route";

const TENANT = "tenant-1";
const ADMIN = { id: "admin-1", role: "TENANT_ADMIN" as const, tenantId: TENANT, name: "Insights Admin" };
const USER = { id: "user-1", role: "USER" as const, tenantId: TENANT };

const getInsights = (params?: Record<string, string>) =>
  GET(request(`/api/insights/bookings?${new URLSearchParams(params).toString()}`));

/** Raw SQL rows, keyed by a fragment of each query. */
function rawRows(rows: { daily?: unknown[]; revenueByDay?: unknown[]; total?: unknown[]; peak?: unknown[]; top?: unknown[]; green?: unknown[] }) {
  prismaMock.$queryRawUnsafe.mockImplementation((async (sql: string) => {
    if (sql.includes("SELECT date as day")) return rows.daily ?? [];
    if (sql.includes("SELECT b.date as day")) return rows.revenueByDay ?? [];
    if (sql.includes("SUM(bp.amount)")) return rows.total ?? [];
    if (sql.includes("EXTRACT(DOW")) return rows.peak ?? [];
    if (sql.includes("LIMIT 10")) return rows.top ?? [];
    if (sql.includes("green_name")) return rows.green ?? [];
    return [];
  }) as never);
}

/** booking.count returns total / confirmed / cancelled depending on the status filter. */
function bookingCounts(total: number, confirmed: number, cancelled: number) {
  prismaMock.booking.count.mockImplementation((async (args: any) =>
    args.where.status === "CONFIRMED" ? confirmed : args.where.status === "CANCELLED" ? cancelled : total) as never);
}

beforeEach(() => {
  // Midday UTC today, so the route's local-time date arithmetic lands on the same calendar day as the helpers.
  const noon = dateFromToday(0);
  noon.setUTCHours(12);
  jest.useFakeTimers({ now: noon, advanceTimers: true });

  prismaMock.featureFlag.findUnique.mockImplementation((async (args: any) => {
    const { tenantId, key } = args.where.tenantId_key;
    return tenantId === TENANT && key === "businessInsights" ? { tenantId, key, enabled: true } : null;
  }) as never);
  bookingCounts(0, 0, 0);
  rawRows({});
});

afterEach(() => {
  jest.useRealTimers();
});

describe("/api/insights/bookings", () => {
  test("returns 401 when not authenticated", async () => {
    const { status } = await readJson(await getInsights());

    expect(status).toBe(401);
    expect(prismaMock.booking.count).not.toHaveBeenCalled();
  });

  test("returns 403 for non-admin user", async () => {
    signInAs(USER);

    const { status } = await readJson(await getInsights());

    expect(status).toBe(403);
    expect(prismaMock.booking.count).not.toHaveBeenCalled();
  });

  test("returns 403 when feature flag is disabled", async () => {
    signInAs(ADMIN);
    prismaMock.featureFlag.findUnique.mockResolvedValue({ enabled: false } as never);

    const { status } = await readJson(await getInsights());

    expect(status).toBe(403);
    expect(prismaMock.featureFlag.findUnique).toHaveBeenCalledWith({
      where: { tenantId_key: { tenantId: TENANT, key: "businessInsights" } },
    });
    expect(prismaMock.booking.count).not.toHaveBeenCalled();
  });

  test("returns booking stats for default period (7d)", async () => {
    signInAs(ADMIN);
    bookingCounts(3, 2, 1);
    rawRows({ total: [{ total: BigInt(2000) }] });

    const { status, body } = await readJson(await getInsights());

    expect(status).toBe(200);
    expect(body.period).toBe("7d");
    expect(body.totalBookings).toBe(3);
    expect(body.confirmedBookings).toBe(2);
    expect(body.cancelledBookings).toBe(1);
    expect(body.cancellationRate).toBe(33); // 1/3 rounded
    expect(body.totalRevenue).toBe(2000);
    expect(prismaMock.booking.count).toHaveBeenCalledWith({ where: { tenantId: TENANT, date: { gte: isoDateFromToday(-7) } } });
  });

  test("cancellation rate is 0 when there are no bookings", async () => {
    signInAs(ADMIN);

    const { body } = await readJson(await getInsights());

    expect(body.totalBookings).toBe(0);
    expect(body.cancellationRate).toBe(0);
    expect(body.totalRevenue).toBe(0);
  });

  test("maps raw rows to numbers and API field names", async () => {
    signInAs(ADMIN);
    const day = isoDateFromToday(-1);
    rawRows({
      daily: [{ day, count: BigInt(2) }],
      revenueByDay: [{ day, total: BigInt(1000) }],
      peak: [{ dow: 3, time_slot: "10:00-12:00", count: BigInt(2) }],
      top: [{ user_id: ADMIN.id, user_name: "Insights Admin", count: BigInt(2) }],
      green: [{ green_name: "Main Green", count: BigInt(3) }],
    });

    const { body } = await readJson(await getInsights());

    expect(body.dailyBookings).toEqual([{ day, count: 2 }]);
    expect(body.revenueByDay).toEqual([{ day, total: 1000 }]);
    expect(body.peakHours).toEqual([{ dow: 3, timeSlot: "10:00-12:00", count: 2 }]);
    expect(body.topBookers).toEqual([{ userId: ADMIN.id, name: "Insights Admin", count: 2 }]);
    expect(body.greenUtilisation).toEqual([{ greenName: "Main Green", count: 3 }]);
  });

  test("respects period parameter", async () => {
    signInAs(ADMIN);

    const { body } = await readJson(await getInsights({ period: "30d" }));

    expect(body.period).toBe("30d");
    expect(prismaMock.booking.count).toHaveBeenCalledWith({ where: { tenantId: TENANT, date: { gte: isoDateFromToday(-30) } } });
  });

  test("every query is scoped to the caller's tenant", async () => {
    signInAs(ADMIN);

    await readJson(await getInsights());

    expect(prismaMock.booking.count).toHaveBeenCalledTimes(3);
    for (const [args] of prismaMock.booking.count.mock.calls) {
      expect((args as any).where.tenantId).toBe(TENANT);
    }
    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledTimes(6);
    for (const [sql, ...params] of prismaMock.$queryRawUnsafe.mock.calls) {
      expect(sql).toContain('"tenantId" = $1');
      expect(params).toEqual([TENANT, isoDateFromToday(-7)]);
    }
  });
});
