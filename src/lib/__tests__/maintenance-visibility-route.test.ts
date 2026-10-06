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

import { GET } from "@/app/api/maintenance/route";
import { PATCH as PATCH_VISIBILITY } from "@/app/api/maintenance/[id]/visibility/route";

let tenantId: string;
let otherTenantId: string;
let adminId: string;
let maintainerId: string;
let memberId: string;
let otherMemberId: string;

let adminTaskId: string;        // MAINTENANCE_ONLY, submittedById = adminId
let memberSubmittedTaskId: string; // MEMBERS, submittedById = memberId
let publicTaskId: string;        // PUBLIC, submittedById = adminId
let maintainerSelfTaskId: string; // MAINTENANCE_ONLY, submittedById = maintainerId
let otherMemberMembersTaskId: string; // MEMBERS but submitted by someone else

function sessionFor(role: string, userId: string, tid = tenantId) {
  return {
    session: {
      user: { id: userId, email: `${role}@test.com`, name: role, role, tenantId: tid },
    },
  };
}

function makeListReq(): NextRequest {
  return new NextRequest(`http://localhost/api/maintenance?tenantId=${tenantId}`);
}

function makePatchReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/maintenance/x/visibility", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "Vis Test Club", slug: "vis-test-" + Date.now() },
  });
  tenantId = tenant.id;

  const other = await prisma.tenant.create({
    data: { name: "Other Vis Club", slug: "other-vis-" + Date.now() },
  });
  otherTenantId = other.id;

  const admin = await prisma.user.create({
    data: { email: `vis-admin-${Date.now()}@test.com`, name: "VAdmin", passwordHash: "x", role: "TENANT_ADMIN", tenantId },
  });
  adminId = admin.id;

  const maintainer = await prisma.user.create({
    data: { email: `vis-mnt-${Date.now()}@test.com`, name: "VMnt", passwordHash: "x", role: "MAINTENANCE", tenantId },
  });
  maintainerId = maintainer.id;

  const member = await prisma.user.create({
    data: { email: `vis-mem-${Date.now()}@test.com`, name: "VMem", passwordHash: "x", role: "USER", tenantId },
  });
  memberId = member.id;

  const otherMember = await prisma.user.create({
    data: { email: `vis-mem2-${Date.now()}@test.com`, name: "VMem2", passwordHash: "x", role: "USER", tenantId },
  });
  otherMemberId = otherMember.id;

  // Mix of tasks with different visibilities and submitters.
  const t1 = await prisma.maintenanceTask.create({
    data: {
      tenantId, title: "Agent triage", description: "x",
      visibility: "MAINTENANCE_ONLY", submittedById: adminId,
    },
  });
  adminTaskId = t1.id;

  const t2 = await prisma.maintenanceTask.create({
    data: {
      tenantId, title: "Members visible", description: "x",
      visibility: "MEMBERS", submittedById: memberId,
    },
  });
  memberSubmittedTaskId = t2.id;

  const t3 = await prisma.maintenanceTask.create({
    data: {
      tenantId, title: "Public", description: "x",
      visibility: "PUBLIC", submittedById: adminId,
    },
  });
  publicTaskId = t3.id;

  const t4 = await prisma.maintenanceTask.create({
    data: {
      tenantId, title: "Maintainer own", description: "x",
      visibility: "MAINTENANCE_ONLY", submittedById: maintainerId,
    },
  });
  maintainerSelfTaskId = t4.id;

  const t5 = await prisma.maintenanceTask.create({
    data: {
      tenantId, title: "Other member visible", description: "x",
      visibility: "MEMBERS", submittedById: otherMemberId,
    },
  });
  otherMemberMembersTaskId = t5.id;
});

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 200));
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.maintenanceTask.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await prisma.$disconnect();
});

describe("GET /api/maintenance — visibility filtering", () => {
  test("TENANT_ADMIN sees all five tasks", async () => {
    mockSessionReturn = sessionFor("TENANT_ADMIN", adminId);
    const res = await GET(makeListReq());
    expect(res.status).toBe(200);
    const tasks = await res.json();
    const ids = tasks.map((t: any) => t.id);
    expect(ids).toEqual(expect.arrayContaining([
      adminTaskId, memberSubmittedTaskId, publicTaskId,
      maintainerSelfTaskId, otherMemberMembersTaskId,
    ]));
  });

  test("MAINTENANCE sees own + MAINTENANCE_ONLY but not arbitrary MEMBERS", async () => {
    mockSessionReturn = sessionFor("MAINTENANCE", maintainerId);
    const res = await GET(makeListReq());
    expect(res.status).toBe(200);
    const ids = (await res.json()).map((t: any) => t.id);
    expect(ids).toEqual(expect.arrayContaining([adminTaskId, maintainerSelfTaskId]));
    expect(ids).not.toContain(memberSubmittedTaskId);
    expect(ids).not.toContain(otherMemberMembersTaskId);
    expect(ids).not.toContain(publicTaskId);
  });

  test("USER sees own + MEMBERS + PUBLIC but never MAINTENANCE_ONLY", async () => {
    mockSessionReturn = sessionFor("USER", memberId);
    const res = await GET(makeListReq());
    expect(res.status).toBe(200);
    const ids = (await res.json()).map((t: any) => t.id);
    expect(ids).toEqual(expect.arrayContaining([
      memberSubmittedTaskId, otherMemberMembersTaskId, publicTaskId,
    ]));
    expect(ids).not.toContain(adminTaskId);
    expect(ids).not.toContain(maintainerSelfTaskId);
  });
});

describe("PATCH /api/maintenance/[id]/visibility", () => {
  test("MAINTENANCE can promote MAINTENANCE_ONLY → MEMBERS, audit row written", async () => {
    mockSessionReturn = sessionFor("MAINTENANCE", maintainerId);
    const res = await PATCH_VISIBILITY(makePatchReq({ visibility: "MEMBERS" }), {
      params: Promise.resolve({ id: adminTaskId }),
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.visibility).toBe("MEMBERS");

    await new Promise((r) => setTimeout(r, 200));
    const audits = await prisma.auditEvent.findMany({
      where: { entityId: adminTaskId, action: "task.visibility_changed" },
    });
    expect(audits.length).toBeGreaterThan(0);
    const meta = typeof audits[0].meta === "string" ? JSON.parse(audits[0].meta) : audits[0].meta;
    expect(meta).toMatchObject({ from: "MAINTENANCE_ONLY", to: "MEMBERS" });

    // Reset for other tests
    await prisma.maintenanceTask.update({
      where: { id: adminTaskId },
      data: { visibility: "MAINTENANCE_ONLY" },
    });
  });

  test("USER (member) is forbidden", async () => {
    mockSessionReturn = sessionFor("USER", memberId);
    const res = await PATCH_VISIBILITY(makePatchReq({ visibility: "PUBLIC" }), {
      params: Promise.resolve({ id: adminTaskId }),
    });
    expect(res.status).toBe(403);
  });

  test("rejects invalid visibility value", async () => {
    mockSessionReturn = sessionFor("MAINTENANCE", maintainerId);
    const res = await PATCH_VISIBILITY(makePatchReq({ visibility: "WORLD" }), {
      params: Promise.resolve({ id: adminTaskId }),
    });
    expect(res.status).toBe(400);
  });

  test("404 for unknown task", async () => {
    mockSessionReturn = sessionFor("MAINTENANCE", maintainerId);
    const res = await PATCH_VISIBILITY(makePatchReq({ visibility: "MEMBERS" }), {
      params: Promise.resolve({ id: "nonexistent-id-xyz" }),
    });
    expect(res.status).toBe(404);
  });

  test("forbids cross-tenant access", async () => {
    mockSessionReturn = sessionFor("TENANT_ADMIN", adminId, otherTenantId);
    const res = await PATCH_VISIBILITY(makePatchReq({ visibility: "PUBLIC" }), {
      params: Promise.resolve({ id: adminTaskId }),
    });
    expect(res.status).toBe(403);
  });

  test("no-op when visibility unchanged returns 200 and no extra audit row", async () => {
    mockSessionReturn = sessionFor("MAINTENANCE", maintainerId);
    const before = await prisma.auditEvent.count({
      where: { entityId: maintainerSelfTaskId, action: "task.visibility_changed" },
    });
    const res = await PATCH_VISIBILITY(makePatchReq({ visibility: "MAINTENANCE_ONLY" }), {
      params: Promise.resolve({ id: maintainerSelfTaskId }),
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    const after = await prisma.auditEvent.count({
      where: { entityId: maintainerSelfTaskId, action: "task.visibility_changed" },
    });
    expect(after).toBe(before);
  });
});
