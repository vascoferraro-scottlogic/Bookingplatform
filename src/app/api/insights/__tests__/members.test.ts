jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

// The member statistics are computed in SQL ($queryRawUnsafe) and Prisma
// count/groupBy, so a mock cannot check the numbers themselves — that needs a
// real database (API test suite). These unit tests cover what the route does
// in JavaScript: the auth/role/flag guards, the tenant scoping and period
// window of every query, and the reshaping of rows (BigInt -> number) into the
// response.

import { prismaMock } from "@/test-utils/prisma-mock";

// groupBy is a heavily overloaded generic, so its deep mock is untyped; cast it.
const groupByMock = (model: { groupBy: unknown }) => model.groupBy as unknown as jest.Mock;
import { signInAs } from "@/test-utils/session";
import { request, readJson } from "@/test-utils/http";
import { GET } from "@/app/api/insights/members/route";

const TENANT_ID = "tenant-1";
const DAY_MS = 86_400_000;

const getMembers = (params?: Record<string, string>) =>
  GET(request(`/api/insights/members?${new URLSearchParams(params).toString()}`));

const signInAsAdmin = (tenantId = TENANT_ID) => signInAs({ id: "members-admin", role: "TENANT_ADMIN", tenantId });

type RawRows = {
  byWeek?: { week: string; count: bigint }[];
  bookers?: bigint;
  messagers?: bigint;
  dormant?: bigint;
  topActive?: { user_id: string; user_name: string; booking_count: bigint; message_count: bigint; total: bigint }[];
};

/** Answer each raw query by recognising its SQL. */
function givenRawRows(rows: RawRows = {}) {
  prismaMock.$queryRawUnsafe.mockImplementation((async (sql: string) => {
    if (sql.includes("LEFT JOIN")) return rows.topActive ?? [];
    if (sql.includes("NOT EXISTS")) return [{ count: rows.dormant ?? BigInt(0) }];
    if (sql.includes("date_trunc")) return rows.byWeek ?? [];
    if (sql.includes('FROM "Booking"')) return [{ count: rows.bookers ?? BigInt(0) }];
    if (sql.includes('FROM "Message"')) return [{ count: rows.messagers ?? BigInt(0) }];
    throw new Error(`unexpected query: ${sql}`);
  }) as never);
}

beforeEach(() => {
  prismaMock.featureFlag.findUnique.mockResolvedValue({ enabled: true } as never);
  prismaMock.user.count.mockResolvedValue(0 as never);
  groupByMock(prismaMock.user).mockResolvedValue([] as never);
  givenRawRows();
});

/** The `since` the route used, read from the "new members" count. */
function sinceUsed(): Date {
  const newMembersCall = prismaMock.user.count.mock.calls.find(([a]) => (a as any)?.where?.createdAt);
  return (newMembersCall![0] as any).where.createdAt.gte;
}

describe("/api/insights/members", () => {
  test("returns 401 when not authenticated", async () => {
    const res = await getMembers();
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-admin user", async () => {
    signInAs({ id: "member", role: "USER", tenantId: TENANT_ID });
    const res = await getMembers();
    expect(res.status).toBe(403);
    expect(prismaMock.user.count).not.toHaveBeenCalled();
  });

  test("returns 403 when the businessInsights flag is off for the tenant", async () => {
    signInAsAdmin();
    prismaMock.featureFlag.findUnique.mockResolvedValue({ enabled: false } as never);

    const { status, body } = await readJson(await getMembers());

    expect(status).toBe(403);
    expect(body.error).toBe("Feature not enabled");
    expect(prismaMock.featureFlag.findUnique).toHaveBeenCalledWith({
      where: { tenantId_key: { tenantId: TENANT_ID, key: "businessInsights" } },
    });
    expect(prismaMock.user.count).not.toHaveBeenCalled();
  });

  test("returns member stats for default period (30d)", async () => {
    signInAsAdmin();
    prismaMock.user.count.mockImplementation((async (args: any) => (args.where.createdAt ? 2 : 3)) as never);
    givenRawRows({ bookers: BigInt(2), messagers: BigInt(1), dormant: BigInt(1) });

    const { status, body } = await readJson(await getMembers());

    expect(status).toBe(200);
    expect(body.period).toBe("30d");
    expect(body.totalMembers).toBe(3);
    expect(body.newMembers).toBe(2);
    expect(body.activeBookers).toBe(2);
    expect(body.activeMessagers).toBe(1);
    expect(body.dormantMembers).toBe(1);
    expect(Math.abs(sinceUsed().getTime() - (Date.now() - 30 * DAY_MS))).toBeLessThan(DAY_MS);
  });

  test.each([
    ["90d", 90],
    ["7d", 7],
    ["anything-else", 7],
  ])("period=%s looks back %i days", async (period, days) => {
    signInAsAdmin();
    const { body } = await readJson(await getMembers({ period }));

    expect(body.period).toBe(period);
    expect(Math.abs(sinceUsed().getTime() - (Date.now() - days * DAY_MS))).toBeLessThan(DAY_MS);
  });

  test("returns role breakdown", async () => {
    signInAsAdmin();
    groupByMock(prismaMock.user).mockResolvedValue([
      { role: "USER", _count: 2 },
      { role: "TENANT_ADMIN", _count: 1 },
    ] as never);

    const { body } = await readJson(await getMembers());

    expect(body.roleBreakdown).toEqual([
      { role: "USER", count: 2 },
      { role: "TENANT_ADMIN", count: 1 },
    ]);
  });

  test("returns top active members with booking + message counts", async () => {
    signInAsAdmin();
    givenRawRows({
      topActive: [
        { user_id: "active", user_name: "Active User", booking_count: BigInt(1), message_count: BigInt(1), total: BigInt(2) },
        { user_id: "members-admin", user_name: "Members Admin", booking_count: BigInt(1), message_count: BigInt(0), total: BigInt(1) },
      ],
    });

    const { body } = await readJson(await getMembers());

    expect(body.topActive).toEqual([
      { userId: "active", name: "Active User", bookings: 1, messages: 1, total: 2 },
      { userId: "members-admin", name: "Members Admin", bookings: 1, messages: 0, total: 1 },
    ]);
  });

  test("returns new members grouped by week", async () => {
    signInAsAdmin();
    givenRawRows({ byWeek: [{ week: "w1", count: BigInt(4) }, { week: "w2", count: BigInt(1) }] });

    const { body } = await readJson(await getMembers());

    expect(body.membersByWeek).toEqual([{ week: "w1", count: 4 }, { week: "w2", count: 1 }]);
  });

  test("count queries that return no rows report zero", async () => {
    signInAsAdmin();
    prismaMock.$queryRawUnsafe.mockResolvedValue([] as never);

    const { body } = await readJson(await getMembers());

    expect(body.activeBookers).toBe(0);
    expect(body.activeMessagers).toBe(0);
    expect(body.dormantMembers).toBe(0);
    expect(body.topActive).toEqual([]);
  });

  test("scopes every query to the caller's tenant", async () => {
    signInAsAdmin("tenant-2");
    await getMembers();

    for (const [args] of prismaMock.user.count.mock.calls) {
      expect((args as any).where).toMatchObject({ tenantId: "tenant-2", suspended: false });
    }
    expect(prismaMock.user.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "tenant-2", suspended: false } }),
    );
    const rawCalls = prismaMock.$queryRawUnsafe.mock.calls;
    expect(rawCalls).toHaveLength(5);
    for (const [sql, firstParam] of rawCalls) {
      expect(sql).toContain('"tenantId" = $1');
      expect(firstParam).toBe("tenant-2");
    }
  });
});
