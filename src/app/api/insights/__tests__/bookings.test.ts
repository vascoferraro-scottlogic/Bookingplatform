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

import { GET } from "@/app/api/insights/bookings/route";

const stamp = Date.now();
const cleanup: { tenantIds: string[]; userIds: string[]; bookingIds: string[] } = {
  tenantIds: [],
  userIds: [],
  bookingIds: [],
};

let tenantId: string;
let adminId: string;
let userId: string;
let rinkId: string;

function adminSession(tid: string, uid: string) {
  return {
    session: {
      user: {
        id: uid,
        email: "insights-admin@test.com",
        name: "Insights Admin",
        role: "TENANT_ADMIN",
        tenantId: tid,
        actingAs: null,
      },
    },
  };
}

function getReq(params?: Record<string, string>) {
  const sp = new URLSearchParams(params);
  return new NextRequest(`http://localhost/api/insights/bookings?${sp.toString()}`);
}

beforeAll(async () => {
  // Tenant + green + rink
  const t = await prisma.tenant.create({
    data: { name: `Insights Club ${stamp}`, slug: `insights-${stamp}`, status: "ACTIVE", active: true },
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

  // Users
  const admin = await prisma.user.create({
    data: { email: `insights-admin-${stamp}@test.com`, name: "Insights Admin", passwordHash: "x", role: "TENANT_ADMIN", tenantId },
  });
  adminId = admin.id;
  cleanup.userIds.push(admin.id);

  const user = await prisma.user.create({
    data: { email: `insights-user-${stamp}@test.com`, name: "Test User", passwordHash: "x", role: "USER", tenantId },
  });
  userId = user.id;
  cleanup.userIds.push(user.id);

  // Feature flag
  await prisma.featureFlag.upsert({
    where: { tenantId_key: { tenantId, key: "businessInsights" } },
    update: { enabled: true },
    create: { tenantId, key: "businessInsights", enabled: true },
  });

  // Bookings — a confirmed one and a cancelled one, both recent
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const b1 = await prisma.booking.create({
    data: {
      tenantId,
      userId: admin.id,
      date: today,
      status: "CONFIRMED",
      slots: { create: [{ rinkId, timeSlot: "10:00-12:00", greenName: "Main Green" }] },
    },
  });
  cleanup.bookingIds.push(b1.id);

  // Add a paid payment to b1
  await prisma.bookingPayment.create({
    data: { bookingId: b1.id, amount: 1000, currency: "GBP", status: "PAID" },
  });

  const b2 = await prisma.booking.create({
    data: {
      tenantId,
      userId: user.id,
      date: yesterday,
      status: "CANCELLED",
      slots: { create: [{ rinkId, timeSlot: "14:00-16:00", greenName: "Main Green" }] },
    },
  });
  cleanup.bookingIds.push(b2.id);

  const b3 = await prisma.booking.create({
    data: {
      tenantId,
      userId: admin.id,
      date: yesterday,
      status: "CONFIRMED",
      slots: { create: [{ rinkId, timeSlot: "10:00-12:00", greenName: "Main Green" }] },
    },
  });
  cleanup.bookingIds.push(b3.id);

  await prisma.bookingPayment.create({
    data: { bookingId: b3.id, amount: 1000, currency: "GBP", status: "PAID" },
  });
});

afterAll(async () => {
  // Clean up in dependency order
  await prisma.bookingPayment.deleteMany({ where: { bookingId: { in: cleanup.bookingIds } } });
  await prisma.bookingSlot.deleteMany({ where: { bookingId: { in: cleanup.bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: cleanup.bookingIds } } });
  await prisma.featureFlag.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.rink.deleteMany({ where: { green: { tenantId: { in: cleanup.tenantIds } } } });
  await prisma.green.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.user.updateMany({ where: { tenantId: { in: cleanup.tenantIds } }, data: { tenantId: null } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: cleanup.tenantIds } } });
  await prisma.$disconnect();
});

describe("/api/insights/bookings", () => {
  beforeEach(() => {
    mockSessionReturn = adminSession(tenantId, adminId);
  });

  test("returns 401 when not authenticated", async () => {
    mockSessionReturn = { error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }) };
    // Actually, getSessionOrFail returns { error: NextResponse }
    const { NextResponse: NR } = await import("next/server");
    mockSessionReturn = { error: NR.json({ error: "Unauthorized" }, { status: 401 }) };
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-admin user", async () => {
    mockSessionReturn = {
      session: {
        user: { id: userId, email: "user@test.com", name: "User", role: "USER", tenantId, actingAs: null },
      },
    };
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });

  test("returns 403 when feature flag is disabled", async () => {
    await prisma.featureFlag.update({
      where: { tenantId_key: { tenantId, key: "businessInsights" } },
      data: { enabled: false },
    });
    const res = await GET(getReq());
    expect(res.status).toBe(403);
    // Re-enable for subsequent tests
    await prisma.featureFlag.update({
      where: { tenantId_key: { tenantId, key: "businessInsights" } },
      data: { enabled: true },
    });
  });

  test("returns booking stats for default period (7d)", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.period).toBe("7d");
    expect(body.totalBookings).toBe(3);
    expect(body.confirmedBookings).toBe(2);
    expect(body.cancelledBookings).toBe(1);
    expect(body.cancellationRate).toBe(33); // 1/3 ≈ 33%
    expect(body.totalRevenue).toBe(2000); // 2 × £10.00
  });

  test("returns daily booking counts", async () => {
    const res = await GET(getReq());
    const body = await res.json();

    expect(body.dailyBookings.length).toBeGreaterThanOrEqual(1);
    for (const d of body.dailyBookings) {
      expect(d).toHaveProperty("day");
      expect(d).toHaveProperty("count");
      expect(typeof d.count).toBe("number");
    }
  });

  test("returns revenue by day", async () => {
    const res = await GET(getReq());
    const body = await res.json();

    expect(body.revenueByDay.length).toBeGreaterThanOrEqual(1);
    const totalFromDays = body.revenueByDay.reduce((s: number, d: any) => s + d.total, 0);
    expect(totalFromDays).toBe(2000);
  });

  test("returns peak hours data", async () => {
    const res = await GET(getReq());
    const body = await res.json();

    expect(body.peakHours.length).toBeGreaterThanOrEqual(1);
    for (const ph of body.peakHours) {
      expect(ph).toHaveProperty("dow");
      expect(ph).toHaveProperty("timeSlot");
      expect(ph).toHaveProperty("count");
    }
  });

  test("returns top bookers", async () => {
    const res = await GET(getReq());
    const body = await res.json();

    expect(body.topBookers.length).toBeGreaterThanOrEqual(1);
    // Admin made 2 bookings, user made 1
    expect(body.topBookers[0].name).toBe("Insights Admin");
    expect(body.topBookers[0].count).toBe(2);
  });

  test("returns green utilisation", async () => {
    const res = await GET(getReq());
    const body = await res.json();

    expect(body.greenUtilisation.length).toBeGreaterThanOrEqual(1);
    expect(body.greenUtilisation[0].greenName).toBe("Main Green");
    expect(body.greenUtilisation[0].count).toBe(3);
  });

  test("respects period parameter", async () => {
    const res = await GET(getReq({ period: "30d" }));
    const body = await res.json();
    expect(body.period).toBe("30d");
    expect(body.totalBookings).toBe(3);
  });

  test("cross-tenant isolation — another tenant sees nothing", async () => {
    const other = await prisma.tenant.create({
      data: { name: `Other Insights ${stamp}`, slug: `other-insights-${stamp}`, status: "ACTIVE", active: true },
    });
    cleanup.tenantIds.push(other.id);

    const otherAdmin = await prisma.user.create({
      data: { email: `other-insights-${stamp}@test.com`, name: "Other Admin", passwordHash: "x", role: "TENANT_ADMIN", tenantId: other.id },
    });
    cleanup.userIds.push(otherAdmin.id);

    await prisma.featureFlag.upsert({
      where: { tenantId_key: { tenantId: other.id, key: "businessInsights" } },
      update: { enabled: true },
      create: { tenantId: other.id, key: "businessInsights", enabled: true },
    });

    mockSessionReturn = adminSession(other.id, otherAdmin.id);
    const res = await GET(getReq());
    const body = await res.json();

    expect(body.totalBookings).toBe(0);
    expect(body.confirmedBookings).toBe(0);
    expect(body.totalRevenue).toBe(0);
    expect(body.topBookers).toEqual([]);
  });
});
