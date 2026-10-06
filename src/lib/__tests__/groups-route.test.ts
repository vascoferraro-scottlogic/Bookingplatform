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

import { GET, POST } from "@/app/api/groups/route";
import { GET as GET_ONE, PATCH, DELETE } from "@/app/api/groups/[id]/route";
import { PUT as PUT_GRANTS } from "@/app/api/groups/[id]/grants/route";
import { POST as POST_MEMBER } from "@/app/api/groups/[id]/members/route";
import { DELETE as DELETE_MEMBER } from "@/app/api/groups/[id]/members/[membershipId]/route";

let tenantId: string;
let adminId: string;
let userId: string;
let membershipId: string;
let customGroupId: string;
let builtInGroupId: string;

function adminSession(tid = tenantId) {
  return {
    session: {
      user: { id: adminId, email: "grp-admin@test.com", name: "Admin", role: "TENANT_ADMIN", tenantId: tid },
    },
  };
}

function userSession() {
  return {
    session: {
      user: { id: userId, email: "grp-user@test.com", name: "User", role: "USER", tenantId },
    },
  };
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeMemberParams(id: string, membershipId: string) {
  return { params: Promise.resolve({ id, membershipId }) };
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "Groups Test Club", slug: `groups-test-${Date.now()}` },
  });
  tenantId = tenant.id;

  const admin = await prisma.user.create({
    data: { email: `grp-admin-${Date.now()}@test.com`, name: "Admin", passwordHash: "x", role: "TENANT_ADMIN", tenantId },
  });
  adminId = admin.id;

  const user = await prisma.user.create({
    data: { email: `grp-user-${Date.now()}@test.com`, name: "User", passwordHash: "x", role: "USER", tenantId },
  });
  userId = user.id;

  const membership = await prisma.membership.create({
    data: { userId, tenantId, role: "USER", status: "ACTIVE" },
  });
  membershipId = membership.id;

  // Seed a built-in group
  const builtIn = await prisma.permissionGroup.create({
    data: {
      tenantId,
      name: "Test Built-In",
      isBuiltIn: true,
      grants: { create: [{ permission: "bookings_view" }] },
    },
  });
  builtInGroupId = builtIn.id;
});

afterAll(async () => {
  await prisma.groupMember.deleteMany({ where: { group: { tenantId } } });
  await prisma.permissionGrant.deleteMany({ where: { group: { tenantId } } });
  await prisma.permissionGroup.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("GET /api/groups — list", () => {
  test("TENANT_ADMIN gets groups list", async () => {
    mockSessionReturn = adminSession();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  test("USER gets 403", async () => {
    mockSessionReturn = userSession();
    const res = await GET();
    expect(res.status).toBe(403);
  });
});

describe("POST /api/groups — create", () => {
  test("creates a custom group", async () => {
    mockSessionReturn = adminSession();
    const req = new Request("http://localhost/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Events Committee", description: "Runs events" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Events Committee");
    expect(body.isBuiltIn).toBe(false);
    customGroupId = body.id;
  });

  test("rejects duplicate name", async () => {
    mockSessionReturn = adminSession();
    const req = new Request("http://localhost/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Events Committee" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  test("rejects empty name", async () => {
    mockSessionReturn = adminSession();
    const req = new Request("http://localhost/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "  " }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/groups/[id] — detail", () => {
  test("returns group with grants and members", async () => {
    mockSessionReturn = adminSession();
    const res = await GET_ONE(new Request("http://localhost"), makeParams(customGroupId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Events Committee");
    expect(Array.isArray(body.grants)).toBe(true);
    expect(Array.isArray(body.members)).toBe(true);
  });

  test("returns 404 for wrong tenant", async () => {
    const otherTenant = await prisma.tenant.create({
      data: { name: "Other Club", slug: `other-grp-${Date.now()}` },
    });
    mockSessionReturn = adminSession(otherTenant.id);
    const res = await GET_ONE(new Request("http://localhost"), makeParams(customGroupId));
    expect(res.status).toBe(404);
    await prisma.tenant.delete({ where: { id: otherTenant.id } });
  });
});

describe("PATCH /api/groups/[id] — update", () => {
  test("renames a custom group", async () => {
    mockSessionReturn = adminSession();
    const req = new Request("http://localhost", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Social Committee" }),
    });
    const res = await PATCH(req, makeParams(customGroupId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Social Committee");
  });

  test("cannot rename a built-in group", async () => {
    mockSessionReturn = adminSession();
    const req = new Request("http://localhost", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    const res = await PATCH(req, makeParams(builtInGroupId));
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/groups/[id]/grants — replace grants", () => {
  test("replaces all grants", async () => {
    mockSessionReturn = adminSession();
    const req = new Request("http://localhost", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissions: ["events_view", "events_create", "events_manage"] }),
    });
    const res = await PUT_GRANTS(req, makeParams(customGroupId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grants).toHaveLength(3);
    expect(body.grants.map((g: any) => g.permission).sort()).toEqual(["events_create", "events_manage", "events_view"]);
  });
});

describe("POST/DELETE /api/groups/[id]/members — member management", () => {
  test("adds a member to a group", async () => {
    mockSessionReturn = adminSession();
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membershipId }),
    });
    const res = await POST_MEMBER(req, makeParams(customGroupId));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.membershipId).toBe(membershipId);
  });

  test("rejects duplicate member", async () => {
    mockSessionReturn = adminSession();
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membershipId }),
    });
    const res = await POST_MEMBER(req, makeParams(customGroupId));
    expect(res.status).toBe(409);
  });

  test("removes a member from a group", async () => {
    mockSessionReturn = adminSession();
    const res = await DELETE_MEMBER(
      new Request("http://localhost"),
      makeMemberParams(customGroupId, membershipId),
    );
    expect(res.status).toBe(200);
  });

  test("removing same member again returns 404", async () => {
    mockSessionReturn = adminSession();
    const res = await DELETE_MEMBER(
      new Request("http://localhost"),
      makeMemberParams(customGroupId, membershipId),
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/groups/[id] — delete", () => {
  test("cannot delete built-in group", async () => {
    mockSessionReturn = adminSession();
    const res = await DELETE(new Request("http://localhost"), makeParams(builtInGroupId));
    expect(res.status).toBe(400);
  });

  test("deletes a custom group", async () => {
    mockSessionReturn = adminSession();
    const res = await DELETE(new Request("http://localhost"), makeParams(customGroupId));
    expect(res.status).toBe(200);
  });

  test("deleted group returns 404", async () => {
    mockSessionReturn = adminSession();
    const res = await GET_ONE(new Request("http://localhost"), makeParams(customGroupId));
    expect(res.status).toBe(404);
  });
});
