import { prisma } from "@/lib/prisma";
import { setFeatureFlag } from "@/lib/features";

let mockSessionReturn: any;

jest.mock("@/lib/api-utils", () => {
  const actual = jest.requireActual("@/lib/api-utils");
  return {
    ...actual,
    getSessionOrFail: jest.fn(() => Promise.resolve(mockSessionReturn)),
  };
});

import { GET, POST } from "@/app/api/federations/route";
import { GET as GET_ONE } from "@/app/api/federations/[id]/route";
import { POST as INVITE } from "@/app/api/federations/[id]/invite/route";
import { GET as GET_INVITE, POST as ACCEPT } from "@/app/api/federations/invite/[token]/route";
import { POST as DECLINE } from "@/app/api/federations/invite/[token]/decline/route";
import { POST as LEAVE } from "@/app/api/federations/[id]/leave/route";
import { GET as ADMIN_LIST } from "@/app/api/admin/federations/route";
import { PATCH as ADMIN_PATCH } from "@/app/api/admin/federations/[id]/route";

let tenantId1: string;
let tenantId2: string;
let adminId1: string;
let adminId2: string;
let slug1: string;
let slug2: string;
let federationId: string;
let inviteToken: string;

function adminSession(id: string, tenantId: string) {
  return {
    session: {
      user: { id, email: `fed-admin-${id}@test.com`, name: "Admin", role: "TENANT_ADMIN", tenantId },
    },
  };
}

function userSession(tenantId: string) {
  return {
    session: {
      user: { id: "u-fed-nope", email: "fed-user@test.com", name: "User", role: "USER", tenantId },
    },
  };
}

function platformAdminSession() {
  return {
    session: {
      user: { id: "pa-fed", email: "pa@test.com", name: "PA", role: "PLATFORM_ADMIN" },
    },
  };
}

function idParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function tokenParams(token: string) {
  return { params: Promise.resolve({ token }) };
}

beforeAll(async () => {
  slug1 = `fed-club1-${Date.now()}`;
  slug2 = `fed-club2-${Date.now()}`;

  const t1 = await prisma.tenant.create({ data: { name: "Fed Club 1", slug: slug1 } });
  const t2 = await prisma.tenant.create({ data: { name: "Fed Club 2", slug: slug2 } });
  tenantId1 = t1.id;
  tenantId2 = t2.id;

  const a1 = await prisma.user.create({
    data: { email: `fed-a1-${Date.now()}@test.com`, name: "Admin1", passwordHash: "x", role: "TENANT_ADMIN", tenantId: tenantId1 },
  });
  const a2 = await prisma.user.create({
    data: { email: `fed-a2-${Date.now()}@test.com`, name: "Admin2", passwordHash: "x", role: "TENANT_ADMIN", tenantId: tenantId2 },
  });
  adminId1 = a1.id;
  adminId2 = a2.id;

  await setFeatureFlag(tenantId1, "federation", true);
  await setFeatureFlag(tenantId2, "federation", true);
});

afterAll(async () => {
  await prisma.federationInvite.deleteMany({ where: { federation: { name: { startsWith: "Test Fed" } } } });
  await prisma.federationMembership.deleteMany({ where: { federation: { name: { startsWith: "Test Fed" } } } });
  await prisma.federation.deleteMany({ where: { name: { startsWith: "Test Fed" } } });
  await prisma.featureFlag.deleteMany({ where: { tenantId: { in: [tenantId1, tenantId2] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId1, adminId2] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId1, tenantId2] } } });
});

// ── Create federation ──────────────────────────────────────

describe("POST /api/federations — create", () => {
  test("TENANT_ADMIN can create a federation", async () => {
    mockSessionReturn = adminSession(adminId1, tenantId1);
    const req = new Request("http://localhost/api/federations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Fed Alpha", description: "For testing" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Test Fed Alpha");
    federationId = body.id;
  });

  test("USER gets 403", async () => {
    mockSessionReturn = userSession(tenantId1);
    const req = new Request("http://localhost/api/federations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Fed Nope" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  test("duplicate name returns 409", async () => {
    mockSessionReturn = adminSession(adminId1, tenantId1);
    const req = new Request("http://localhost/api/federations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Fed Alpha" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  test("federation feature disabled returns 403", async () => {
    await setFeatureFlag(tenantId1, "federation", false);
    mockSessionReturn = adminSession(adminId1, tenantId1);
    const req = new Request("http://localhost/api/federations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Fed Blocked" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    await setFeatureFlag(tenantId1, "federation", true);
  });
});

// ── List federations ──────────────────────────────────────

describe("GET /api/federations — list", () => {
  test("returns club's federations", async () => {
    mockSessionReturn = adminSession(adminId1, tenantId1);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].name).toBe("Test Fed Alpha");
  });

  test("club not in federation gets empty list", async () => {
    mockSessionReturn = adminSession(adminId2, tenantId2);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(0);
  });
});

// ── Federation detail ──────────────────────────────────────

describe("GET /api/federations/[id] — detail", () => {
  test("member sees federation detail", async () => {
    mockSessionReturn = adminSession(adminId1, tenantId1);
    const res = await GET_ONE(new Request("http://localhost"), idParams(federationId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Test Fed Alpha");
    expect(body.memberships.length).toBe(1);
  });

  test("non-member gets 404", async () => {
    mockSessionReturn = adminSession(adminId2, tenantId2);
    const res = await GET_ONE(new Request("http://localhost"), idParams(federationId));
    expect(res.status).toBe(404);
  });
});

// ── Invite + accept lifecycle ──────────────────────────────

describe("Federation invite lifecycle", () => {
  test("member can invite another club", async () => {
    mockSessionReturn = adminSession(adminId1, tenantId1);
    const req = new Request("http://localhost/api/federations/" + federationId + "/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantSlug: slug2 }),
    });
    const res = await INVITE(req, idParams(federationId));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.inviteeTenant.slug).toBe(slug2);
    inviteToken = body.token;
  });

  test("cannot invite same club twice", async () => {
    mockSessionReturn = adminSession(adminId1, tenantId1);
    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantSlug: slug2 }),
    });
    const res = await INVITE(req, idParams(federationId));
    expect(res.status).toBe(409);
  });

  test("invited club can fetch invite", async () => {
    mockSessionReturn = adminSession(adminId2, tenantId2);
    const res = await GET_INVITE(new Request("http://localhost"), tokenParams(inviteToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.federation.name).toBe("Test Fed Alpha");
  });

  test("invited club can accept", async () => {
    mockSessionReturn = adminSession(adminId2, tenantId2);
    const res = await ACCEPT(new Request("http://localhost", { method: "POST" }), tokenParams(inviteToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("accepting again returns 400", async () => {
    mockSessionReturn = adminSession(adminId2, tenantId2);
    const res = await ACCEPT(new Request("http://localhost", { method: "POST" }), tokenParams(inviteToken));
    expect(res.status).toBe(400);
  });

  test("federation now has 2 members", async () => {
    mockSessionReturn = adminSession(adminId1, tenantId1);
    const res = await GET_ONE(new Request("http://localhost"), idParams(federationId));
    const body = await res.json();
    expect(body.memberships.length).toBe(2);
  });
});

// ── Decline ──────────────────────────────────────────────

describe("POST /api/federations/invite/[token]/decline", () => {
  test("cannot decline an already-accepted invite", async () => {
    mockSessionReturn = adminSession(adminId2, tenantId2);
    const res = await DECLINE(new Request("http://localhost", { method: "POST" }), tokenParams(inviteToken));
    expect(res.status).toBe(400);
  });
});

// ── Leave ──────────────────────────────────────────────

describe("POST /api/federations/[id]/leave", () => {
  test("member can leave a federation", async () => {
    mockSessionReturn = adminSession(adminId2, tenantId2);
    const res = await LEAVE(new Request("http://localhost", { method: "POST" }), idParams(federationId));
    expect(res.status).toBe(200);
  });

  test("leaving again returns 404", async () => {
    mockSessionReturn = adminSession(adminId2, tenantId2);
    const res = await LEAVE(new Request("http://localhost", { method: "POST" }), idParams(federationId));
    expect(res.status).toBe(404);
  });

  test("federation now has 1 member", async () => {
    mockSessionReturn = adminSession(adminId1, tenantId1);
    const res = await GET_ONE(new Request("http://localhost"), idParams(federationId));
    const body = await res.json();
    expect(body.memberships.length).toBe(1);
  });
});

// ── Platform admin ──────────────────────────────────────

describe("Platform admin federation routes", () => {
  test("GET /api/admin/federations lists all", async () => {
    mockSessionReturn = platformAdminSession();
    const res = await ADMIN_LIST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.some((f: any) => f.name === "Test Fed Alpha")).toBe(true);
  });

  test("PATCH /api/admin/federations/[id] suspends", async () => {
    mockSessionReturn = platformAdminSession();
    const req = new Request("http://localhost", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "SUSPENDED" }),
    });
    const res = await ADMIN_PATCH(req, idParams(federationId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("SUSPENDED");
  });

  test("TENANT_ADMIN gets 403 on admin route", async () => {
    mockSessionReturn = adminSession(adminId1, tenantId1);
    const res = await ADMIN_LIST();
    expect(res.status).toBe(403);
  });
});
