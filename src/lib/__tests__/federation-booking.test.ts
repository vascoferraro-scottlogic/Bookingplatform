import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import { setFeatureFlag } from "@/lib/features";

let mockSessionReturn: any;

jest.mock("@/lib/api-utils", () => {
  const actual = jest.requireActual("@/lib/api-utils");
  return {
    ...actual,
    getSessionOrFail: jest.fn(() => Promise.resolve(mockSessionReturn)),
  };
});

import { POST } from "@/app/api/bookings/route";

let homeClubId: string;
let awayClubId: string;
let homeAdminId: string;
let homeUserId: string;
let homeMembershipId: string;
let homeRinkId: string;
let awayRinkId: string;
let federationId: string;
let groupId: string;

function homeUserSession() {
  return {
    session: {
      user: { id: homeUserId, email: "fed-booker@test.com", name: "Booker", role: "USER", tenantId: homeClubId },
    },
  };
}

function homeAdminSession() {
  return {
    session: {
      user: { id: homeAdminId, email: "fed-admin@test.com", name: "Admin", role: "TENANT_ADMIN", tenantId: homeClubId },
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
  const ts = Date.now();

  // Two clubs
  const home = await prisma.tenant.create({ data: { name: "Home Club", slug: `fed-bk-home-${ts}` } });
  const away = await prisma.tenant.create({ data: { name: "Away Club", slug: `fed-bk-away-${ts}` } });
  homeClubId = home.id;
  awayClubId = away.id;

  // Admin + regular user at home club
  const admin = await prisma.user.create({
    data: { email: `fed-bk-admin-${ts}@test.com`, name: "Admin", passwordHash: "x", role: "TENANT_ADMIN", tenantId: homeClubId },
  });
  homeAdminId = admin.id;

  const user = await prisma.user.create({
    data: { email: `fed-bk-user-${ts}@test.com`, name: "Booker", passwordHash: "x", role: "USER", tenantId: homeClubId },
  });
  homeUserId = user.id;

  const membership = await prisma.membership.create({
    data: { userId: homeUserId, tenantId: homeClubId, role: "USER", status: "ACTIVE" },
  });
  homeMembershipId = membership.id;

  // Greens + rinks at both clubs
  const homeGreen = await prisma.green.create({ data: { tenantId: homeClubId, name: "Home Green" } });
  const homeRink = await prisma.rink.create({ data: { greenId: homeGreen.id, name: "Home Rink 1" } });
  homeRinkId = homeRink.id;

  const awayGreen = await prisma.green.create({ data: { tenantId: awayClubId, name: "Away Green" } });
  const awayRink = await prisma.rink.create({ data: { greenId: awayGreen.id, name: "Away Rink 1" } });
  awayRinkId = awayRink.id;

  // Federation with both clubs as members
  const fed = await prisma.federation.create({
    data: {
      name: `Test Cross-Club Fed ${ts}`,
      createdByTenantId: homeClubId,
      memberships: {
        create: [
          { tenantId: homeClubId, billingMode: "HOST_CLUB_RATE" },
          { tenantId: awayClubId, billingMode: "FREE_ACCESS" },
        ],
      },
    },
  });
  federationId = fed.id;

  // Enable federation feature on home club
  await setFeatureFlag(homeClubId, "federation", true);

  // Permission group with federation_book_at_partners grant, assign user
  const group = await prisma.permissionGroup.create({
    data: {
      tenantId: homeClubId,
      name: `Federation Bookers ${ts}`,
      grants: { create: [{ permission: "federation_book_at_partners" }] },
      members: { create: [{ membershipId: homeMembershipId }] },
    },
  });
  groupId = group.id;
});

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 200));
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: [homeClubId, awayClubId] } } });
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: [homeAdminId, homeUserId] } } });
  await prisma.bookingSlot.deleteMany({ where: { booking: { tenantId: { in: [homeClubId, awayClubId] } } } });
  await prisma.booking.deleteMany({ where: { tenantId: { in: [homeClubId, awayClubId] } } });
  await prisma.groupMember.deleteMany({ where: { group: { tenantId: homeClubId } } });
  await prisma.permissionGrant.deleteMany({ where: { group: { tenantId: homeClubId } } });
  await prisma.permissionGroup.deleteMany({ where: { tenantId: homeClubId } });
  await prisma.membership.deleteMany({ where: { tenantId: homeClubId } });
  await prisma.federationMembership.deleteMany({ where: { federationId } });
  await prisma.federation.deleteMany({ where: { id: federationId } });
  await prisma.featureFlag.deleteMany({ where: { tenantId: { in: [homeClubId, awayClubId] } } });
  await prisma.rink.deleteMany({ where: { green: { tenantId: { in: [homeClubId, awayClubId] } } } });
  await prisma.green.deleteMany({ where: { tenantId: { in: [homeClubId, awayClubId] } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: [homeClubId, awayClubId] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [homeClubId, awayClubId] } } });
});

// ── Same-club booking still works ─────────────────────────────

describe("Same-club booking (no regression)", () => {
  test("booking at own club works without targetTenantId", async () => {
    mockSessionReturn = homeUserSession();
    const res = await POST(makeJsonRequest({
      date: "2026-07-01",
      slots: [{ rinkId: homeRinkId, timeSlot: "09:00" }],
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tenantId).toBe(homeClubId);
    expect(body.bookedByTenantId).toBeNull();
    expect(body.federationId).toBeNull();
  });
});

// ── Cross-club booking ────────────────────────────────────────

describe("Cross-club booking via federation", () => {
  test("user with federation permission can book at partner club", async () => {
    mockSessionReturn = homeUserSession();
    const res = await POST(makeJsonRequest({
      date: "2026-07-02",
      targetTenantId: awayClubId,
      slots: [{ rinkId: awayRinkId, timeSlot: "10:00" }],
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tenantId).toBe(awayClubId);
    expect(body.bookedByTenantId).toBe(homeClubId);
    expect(body.federationId).toBe(federationId);
  });

  test("user without federation permission gets 403", async () => {
    // Remove user from group temporarily
    await prisma.groupMember.deleteMany({ where: { membershipId: homeMembershipId } });

    mockSessionReturn = homeUserSession();
    const res = await POST(makeJsonRequest({
      date: "2026-07-03",
      targetTenantId: awayClubId,
      slots: [{ rinkId: awayRinkId, timeSlot: "10:00" }],
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("permission");

    // Restore
    await prisma.groupMember.create({ data: { groupId, membershipId: homeMembershipId } });
  });

  test("TENANT_ADMIN can cross-club book (implicit all-permissions)", async () => {
    mockSessionReturn = homeAdminSession();
    const res = await POST(makeJsonRequest({
      date: "2026-07-03",
      targetTenantId: awayClubId,
      slots: [{ rinkId: awayRinkId, timeSlot: "11:00" }],
    }));
    expect(res.status).toBe(201);
  });

  test("club not in federation gets 403", async () => {
    // Leave away club from federation
    await prisma.federationMembership.updateMany({
      where: { federationId, tenantId: awayClubId },
      data: { leftAt: new Date() },
    });

    mockSessionReturn = homeUserSession();
    const res = await POST(makeJsonRequest({
      date: "2026-07-04",
      targetTenantId: awayClubId,
      slots: [{ rinkId: awayRinkId, timeSlot: "10:00" }],
    }));
    expect(res.status).toBe(403);

    // Restore
    await prisma.federationMembership.updateMany({
      where: { federationId, tenantId: awayClubId },
      data: { leftAt: null },
    });
  });

  test("federation feature disabled gets 403", async () => {
    await setFeatureFlag(homeClubId, "federation", false);

    mockSessionReturn = homeUserSession();
    const res = await POST(makeJsonRequest({
      date: "2026-07-05",
      targetTenantId: awayClubId,
      slots: [{ rinkId: awayRinkId, timeSlot: "10:00" }],
    }));
    expect(res.status).toBe(403);

    await setFeatureFlag(homeClubId, "federation", true);
  });
});

// ── Cross-club clash detection ────────────────────────────────

describe("Cross-club clash detection", () => {
  test("same slot at different clubs returns CROSS_CLUB_CLASH", async () => {
    // First: book at home club
    mockSessionReturn = homeUserSession();
    const homeRes = await POST(makeJsonRequest({
      date: "2026-07-10",
      slots: [{ rinkId: homeRinkId, timeSlot: "14:00-16:00" }],
    }));
    expect(homeRes.status).toBe(201);

    // Then: try to book same slot at away club
    const awayRes = await POST(makeJsonRequest({
      date: "2026-07-10",
      targetTenantId: awayClubId,
      slots: [{ rinkId: awayRinkId, timeSlot: "14:00-16:00" }],
    }));
    expect(awayRes.status).toBe(409);
    const body = await awayRes.json();
    expect(body.error).toBe("CROSS_CLUB_CLASH");
    expect(body.confirm).toBe(true);
  });

  test("adjacent slot returns CROSS_CLUB_CONSECUTIVE", async () => {
    mockSessionReturn = homeUserSession();
    const res = await POST(makeJsonRequest({
      date: "2026-07-10",
      targetTenantId: awayClubId,
      slots: [{ rinkId: awayRinkId, timeSlot: "16:00-18:00" }],
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("CROSS_CLUB_CONSECUTIVE");
    expect(body.confirm).toBe(true);
  });

  test("confirmClash bypasses clash warning", async () => {
    mockSessionReturn = homeUserSession();
    const res = await POST(makeJsonRequest({
      date: "2026-07-10",
      targetTenantId: awayClubId,
      confirmClash: true,
      slots: [{ rinkId: awayRinkId, timeSlot: "14:00-16:00" }],
    }));
    expect(res.status).toBe(201);
  });
});
