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

import { GET, POST } from "@/app/api/bookings/route";

let tenantId: string;
let tenantId2: string;
let adminId: string;
let userId: string;
let userId2: string;
let crossTenantUserId: string;
let rinkId: string;

function adminSession() {
  return {
    session: {
      user: { id: adminId, email: "admin@test.com", name: "Admin", role: "TENANT_ADMIN", tenantId },
    },
  };
}

function userSession() {
  return {
    session: {
      user: { id: userId, email: "user@test.com", name: "User", role: "USER", tenantId },
    },
  };
}

function makeJsonRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "Bookings Test Club", slug: "bookings-test-" + Date.now() },
  });
  tenantId = tenant.id;

  const tenant2 = await prisma.tenant.create({
    data: { name: "Other Club", slug: "other-test-" + Date.now() },
  });
  tenantId2 = tenant2.id;

  const admin = await prisma.user.create({
    data: { email: `bk-admin-${Date.now()}@test.com`, name: "Admin", passwordHash: "x", role: "TENANT_ADMIN", tenantId },
  });
  adminId = admin.id;

  const user = await prisma.user.create({
    data: { email: `bk-user-${Date.now()}@test.com`, name: "User", passwordHash: "x", role: "USER", tenantId },
  });
  userId = user.id;

  const user2 = await prisma.user.create({
    data: { email: `bk-user2-${Date.now()}@test.com`, name: "User2", passwordHash: "x", role: "USER", tenantId },
  });
  userId2 = user2.id;

  const crossUser = await prisma.user.create({
    data: { email: `bk-cross-${Date.now()}@test.com`, name: "CrossUser", passwordHash: "x", role: "USER", tenantId: tenantId2 },
  });
  crossTenantUserId = crossUser.id;

  const green = await prisma.green.create({
    data: { tenantId, name: "Test Green" },
  });
  const rink = await prisma.rink.create({
    data: { greenId: green.id, name: "Rink A" },
  });
  rinkId = rink.id;
});

afterAll(async () => {
  // logAudit is fire-and-forget so give it a moment to persist
  await new Promise((r) => setTimeout(r, 200));
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: [tenantId, tenantId2] } } });
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: [adminId, userId, userId2, crossTenantUserId] } } });
  await prisma.bookingSlot.deleteMany({ where: { booking: { tenantId: { in: [tenantId, tenantId2] } } } });
  await prisma.booking.deleteMany({ where: { tenantId: { in: [tenantId, tenantId2] } } });
  await prisma.rink.deleteMany({ where: { green: { tenantId } } });
  await prisma.green.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId: { in: [tenantId, tenantId2] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, tenantId2] } } });
  await prisma.$disconnect();
});

// ── Self-booking ───────────────────────────────────────────────

describe("POST /api/bookings - self booking", () => {
  test("creates booking with userId = bookedByUserId = actor", async () => {
    mockSessionReturn = userSession();
    const res = await POST(makeJsonRequest({
      date: "2026-06-01",
      slots: [{ rinkId, timeSlot: "09:00" }],
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.userId).toBe(userId);
    expect(data.bookedByUserId).toBe(userId);
    expect(data.adminOverride).toBe(false);
  });
});

// ── Book-on-behalf ─────────────────────────────────────────────

describe("POST /api/bookings - book on behalf", () => {
  test("admin can book for another member in same tenant", async () => {
    mockSessionReturn = adminSession();
    const res = await POST(makeJsonRequest({
      date: "2026-06-02",
      slots: [{ rinkId, timeSlot: "10:00" }],
      bookForUserId: userId2,
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.userId).toBe(userId2);
    expect(data.bookedByUserId).toBe(adminId);
  });

  test("non-admin cannot book for someone else (403)", async () => {
    mockSessionReturn = userSession();
    const res = await POST(makeJsonRequest({
      date: "2026-06-02",
      slots: [{ rinkId, timeSlot: "11:00" }],
      bookForUserId: userId2,
    }));
    expect(res.status).toBe(403);
  });

  test("admin cannot book for user in different tenant (404)", async () => {
    mockSessionReturn = adminSession();
    const res = await POST(makeJsonRequest({
      date: "2026-06-02",
      slots: [{ rinkId, timeSlot: "12:00" }],
      bookForUserId: crossTenantUserId,
    }));
    expect(res.status).toBe(404);
  });
});

// ── Admin override ─────────────────────────────────────────────

describe("POST /api/bookings - admin override", () => {
  test("non-admin cannot use adminOverride (403)", async () => {
    mockSessionReturn = userSession();
    const res = await POST(makeJsonRequest({
      date: "2026-06-03",
      slots: [{ rinkId, timeSlot: "09:00" }],
      adminOverride: true,
      overrideReason: "Testing",
    }));
    expect(res.status).toBe(403);
  });

  test("admin override without reason is rejected (400)", async () => {
    mockSessionReturn = adminSession();
    const res = await POST(makeJsonRequest({
      date: "2026-06-03",
      slots: [{ rinkId, timeSlot: "09:00" }],
      adminOverride: true,
      overrideReason: "",
    }));
    expect(res.status).toBe(400);
  });

  test("admin override bypasses conflict check", async () => {
    mockSessionReturn = adminSession();
    // First booking takes the slot
    const res1 = await POST(makeJsonRequest({
      date: "2026-06-04",
      slots: [{ rinkId, timeSlot: "14:00" }],
    }));
    expect(res1.status).toBe(201);
    const booking1 = await res1.json();

    // Approve it so it conflicts
    await prisma.booking.update({ where: { id: booking1.id }, data: { status: "APPROVED" } });

    // Normal booking should conflict
    const res2 = await POST(makeJsonRequest({
      date: "2026-06-04",
      slots: [{ rinkId, timeSlot: "14:00" }],
    }));
    expect(res2.status).toBe(409);

    // Admin override should bypass conflict
    const res3 = await POST(makeJsonRequest({
      date: "2026-06-04",
      slots: [{ rinkId, timeSlot: "14:00" }],
      adminOverride: true,
      overrideReason: "Emergency coaching session",
    }));
    expect(res3.status).toBe(201);
    const data = await res3.json();
    expect(data.adminOverride).toBe(true);
    expect(data.overrideReason).toBe("Emergency coaching session");
  });
});

// ── GET ────────────────────────────────────────────────────────

describe("GET /api/bookings", () => {
  test("includes bookedByUser in response", async () => {
    mockSessionReturn = adminSession();
    const req = new NextRequest("http://localhost/api/bookings");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const bookings = await res.json();
    expect(bookings.length).toBeGreaterThan(0);
    // At least one booking by admin for another user
    const onBehalf = bookings.find((b: any) => b.bookedByUserId !== b.userId);
    expect(onBehalf).toBeDefined();
    expect(onBehalf.bookedByUser).toBeDefined();
    expect(onBehalf.bookedByUser.id).toBe(adminId);
  });
});
