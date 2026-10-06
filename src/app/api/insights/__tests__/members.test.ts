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

import { GET } from "@/app/api/insights/members/route";

const stamp = Date.now();
const cleanup: { tenantIds: string[]; userIds: string[]; bookingIds: string[]; channelIds: string[] } = {
  tenantIds: [],
  userIds: [],
  bookingIds: [],
  channelIds: [],
};

let tenantId: string;
let adminId: string;
let activeUserId: string;
let dormantUserId: string;
let rinkId: string;

function adminSession(tid: string, uid: string) {
  return {
    session: {
      user: {
        id: uid,
        email: "members-admin@test.com",
        name: "Members Admin",
        role: "TENANT_ADMIN",
        tenantId: tid,
        actingAs: null,
      },
    },
  };
}

function getReq(params?: Record<string, string>) {
  const sp = new URLSearchParams(params);
  return new NextRequest(`http://localhost/api/insights/members?${sp.toString()}`);
}

beforeAll(async () => {
  // Tenant + green + rink
  const t = await prisma.tenant.create({
    data: { name: `Members Club ${stamp}`, slug: `members-${stamp}`, status: "ACTIVE", active: true },
  });
  tenantId = t.id;
  cleanup.tenantIds.push(t.id);

  const green = await prisma.green.create({
    data: { name: "Test Green", tenantId },
  });
  const rink = await prisma.rink.create({
    data: { name: "Rink A", greenId: green.id },
  });
  rinkId = rink.id;

  // Feature flag
  await prisma.featureFlag.upsert({
    where: { tenantId_key: { tenantId, key: "businessInsights" } },
    update: { enabled: true },
    create: { tenantId, key: "businessInsights", enabled: true },
  });

  // Users
  const admin = await prisma.user.create({
    data: { email: `members-admin-${stamp}@test.com`, name: "Members Admin", passwordHash: "x", role: "TENANT_ADMIN", tenantId },
  });
  adminId = admin.id;
  cleanup.userIds.push(admin.id);

  const active = await prisma.user.create({
    data: { email: `members-active-${stamp}@test.com`, name: "Active User", passwordHash: "x", role: "USER", tenantId },
  });
  activeUserId = active.id;
  cleanup.userIds.push(active.id);

  const dormant = await prisma.user.create({
    data: {
      email: `members-dormant-${stamp}@test.com`,
      name: "Dormant User",
      passwordHash: "x",
      role: "USER",
      tenantId,
      createdAt: new Date(Date.now() - 180 * 86400000), // 180 days ago
    },
  });
  dormantUserId = dormant.id;
  cleanup.userIds.push(dormant.id);

  // Active user has a recent booking
  const today = new Date().toISOString().slice(0, 10);
  const b1 = await prisma.booking.create({
    data: {
      tenantId,
      userId: active.id,
      date: today,
      status: "CONFIRMED",
      slots: { create: [{ rinkId, timeSlot: "10:00-12:00", greenName: "Test Green" }] },
    },
  });
  cleanup.bookingIds.push(b1.id);

  // Active user sent a message
  const channel = await prisma.channel.create({
    data: {
      tenantId,
      name: `test-channel-${stamp}`,
      type: "PUBLIC",
      createdById: admin.id,
    },
  });
  cleanup.channelIds.push(channel.id);

  await prisma.message.create({
    data: {
      channelId: channel.id,
      tenantId,
      userId: active.id,
      body: "Hello from test",
    },
  });

  // Admin also has a booking (for top active)
  const b2 = await prisma.booking.create({
    data: {
      tenantId,
      userId: admin.id,
      date: today,
      status: "CONFIRMED",
      slots: { create: [{ rinkId, timeSlot: "14:00-16:00", greenName: "Test Green" }] },
    },
  });
  cleanup.bookingIds.push(b2.id);
});

afterAll(async () => {
  await prisma.message.deleteMany({ where: { channelId: { in: cleanup.channelIds } } });
  await prisma.channelMember.deleteMany({ where: { channelId: { in: cleanup.channelIds } } });
  await prisma.channel.deleteMany({ where: { id: { in: cleanup.channelIds } } });
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

describe("/api/insights/members", () => {
  beforeEach(() => {
    mockSessionReturn = adminSession(tenantId, adminId);
  });

  test("returns 401 when not authenticated", async () => {
    const { NextResponse: NR } = await import("next/server");
    mockSessionReturn = { error: NR.json({ error: "Unauthorized" }, { status: 401 }) };
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-admin user", async () => {
    mockSessionReturn = {
      session: {
        user: { id: activeUserId, email: "user@test.com", name: "User", role: "USER", tenantId, actingAs: null },
      },
    };
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });

  test("returns member stats for default period (30d)", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.period).toBe("30d");
    expect(body.totalMembers).toBe(3); // admin + active + dormant
    expect(body.activeBookers).toBeGreaterThanOrEqual(2); // admin + active
    expect(body.activeMessagers).toBeGreaterThanOrEqual(1); // active
  });

  test("returns dormant member count", async () => {
    const res = await GET(getReq());
    const body = await res.json();

    // Dormant user created 180 days ago with no bookings or messages
    expect(body.dormantMembers).toBeGreaterThanOrEqual(1);
  });

  test("returns role breakdown", async () => {
    const res = await GET(getReq());
    const body = await res.json();

    expect(body.roleBreakdown.length).toBeGreaterThanOrEqual(1);
    const roles = body.roleBreakdown.map((r: any) => r.role);
    expect(roles).toContain("USER");
    expect(roles).toContain("TENANT_ADMIN");
  });

  test("returns top active members with booking + message counts", async () => {
    const res = await GET(getReq());
    const body = await res.json();

    expect(body.topActive.length).toBeGreaterThanOrEqual(1);
    // Active user has 1 booking + 1 message = 2 total; admin has 1 booking = 1 total
    const activeEntry = body.topActive.find((m: any) => m.name === "Active User");
    expect(activeEntry).toBeDefined();
    expect(activeEntry.bookings).toBe(1);
    expect(activeEntry.messages).toBe(1);
    expect(activeEntry.total).toBe(2);
  });

  test("returns new members count", async () => {
    const res = await GET(getReq());
    const body = await res.json();

    // admin + active created recently; dormant created 180 days ago
    expect(body.newMembers).toBe(2);
  });

  test("cross-tenant isolation", async () => {
    const other = await prisma.tenant.create({
      data: { name: `Other Members ${stamp}`, slug: `other-mem-${stamp}`, status: "ACTIVE", active: true },
    });
    cleanup.tenantIds.push(other.id);

    const otherAdmin = await prisma.user.create({
      data: { email: `other-mem-${stamp}@test.com`, name: "Other Admin", passwordHash: "x", role: "TENANT_ADMIN", tenantId: other.id },
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

    expect(body.totalMembers).toBe(1); // just the other admin
    expect(body.activeBookers).toBe(0);
    expect(body.activeMessagers).toBe(0);
    expect(body.topActive).toEqual([]);
  });
});
