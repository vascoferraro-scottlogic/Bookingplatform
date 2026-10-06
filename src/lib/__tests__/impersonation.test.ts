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

import { GET, POST, DELETE } from "@/app/api/platform/impersonation/route";

let tenantId: string;
let inactiveTenantId: string;
let platformAdminId: string;
let regularUserId: string;

function platformSession(actingAs: any = null) {
  return {
    session: {
      user: {
        id: platformAdminId,
        email: "platform@test.com",
        name: "Platform Admin",
        role: "PLATFORM_ADMIN",
        tenantId: null,
        actingAs,
      },
    },
  };
}

function regularSession() {
  return {
    session: {
      user: {
        id: regularUserId,
        email: "user@test.com",
        name: "Regular",
        role: "USER",
        tenantId,
        actingAs: null,
      },
    },
  };
}

function jsonRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/platform/impersonation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// logAudit is fire-and-forget; poll briefly until rows appear (or timeout).
async function waitForAudit(
  where: Record<string, unknown>,
  expected = 1,
  timeoutMs = 1000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const count = await prisma.auditEvent.count({ where });
    if (count >= expected) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  const slug = "imp-test-" + Date.now();
  const tenant = await prisma.tenant.create({
    data: { name: "Impersonation Test Club", slug, active: true },
  });
  tenantId = tenant.id;

  const inactive = await prisma.tenant.create({
    data: { name: "Inactive Club", slug: slug + "-inactive", active: false, status: "SUSPENDED" },
  });
  inactiveTenantId = inactive.id;

  const admin = await prisma.user.create({
    data: {
      email: `imp-admin-${Date.now()}@test.com`,
      name: "Platform Admin",
      passwordHash: "x",
      role: "PLATFORM_ADMIN",
      tenantId: null,
    },
  });
  platformAdminId = admin.id;

  const user = await prisma.user.create({
    data: {
      email: `imp-user-${Date.now()}@test.com`,
      name: "Regular",
      passwordHash: "x",
      role: "USER",
      tenantId,
    },
  });
  regularUserId = user.id;
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({
    where: { OR: [{ actorId: platformAdminId }, { tenantId }, { tenantId: inactiveTenantId }] },
  });
  await prisma.impersonation.deleteMany({ where: { platformUserId: platformAdminId } });
  await prisma.user.deleteMany({ where: { id: { in: [platformAdminId, regularUserId] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, inactiveTenantId] } } });
  await prisma.$disconnect();
});

afterEach(async () => {
  // Clean up any open impersonations between tests
  await prisma.impersonation.deleteMany({ where: { platformUserId: platformAdminId } });
  await prisma.auditEvent.deleteMany({ where: { actorId: platformAdminId } });
});

// ── POST ──────────────────────────────────────────────────

describe("POST /api/platform/impersonation", () => {
  test("returns 403 when caller is not PLATFORM_ADMIN", async () => {
    mockSessionReturn = regularSession();
    const res = await POST(jsonRequest({ tenantId }));
    expect(res.status).toBe(403);
  });

  test("returns 400 when tenantId missing", async () => {
    mockSessionReturn = platformSession();
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
  });

  test("returns 404 when tenant does not exist", async () => {
    mockSessionReturn = platformSession();
    const res = await POST(jsonRequest({ tenantId: "no-such-tenant" }));
    expect(res.status).toBe(404);
  });

  test("returns 400 when tenant is SUSPENDED", async () => {
    mockSessionReturn = platformSession();
    const res = await POST(jsonRequest({ tenantId: inactiveTenantId }));
    expect(res.status).toBe(400);
  });

  test("creates Impersonation row and returns actingAs claim", async () => {
    mockSessionReturn = platformSession();
    const res = await POST(jsonRequest({ tenantId, reason: "Investigating booking issue" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.actingAs).toMatchObject({
      tenantId,
      role: "TENANT_ADMIN",
    });
    expect(body.actingAs.impersonationId).toBeTruthy();
    expect(body.actingAs.tenantName).toBe("Impersonation Test Club");

    const row = await prisma.impersonation.findUnique({
      where: { id: body.actingAs.impersonationId },
    });
    expect(row).not.toBeNull();
    expect(row!.platformUserId).toBe(platformAdminId);
    expect(row!.tenantId).toBe(tenantId);
    expect(row!.assumedRole).toBe("TENANT_ADMIN");
    expect(row!.endedAt).toBeNull();
    expect(row!.reason).toBe("Investigating booking issue");
  });

  test("writes a platform.impersonation.start audit event", async () => {
    mockSessionReturn = platformSession();
    const res = await POST(jsonRequest({ tenantId }));
    const body = await res.json();
    await waitForAudit({ actorId: platformAdminId, action: "platform.impersonation.start" });
    const audits = await prisma.auditEvent.findMany({
      where: { actorId: platformAdminId, action: "platform.impersonation.start" },
    });
    expect(audits.length).toBe(1);
    expect(audits[0].entityId).toBe(body.actingAs.impersonationId);
    expect(audits[0].tenantId).toBe(tenantId);
  });

  test("starting a second impersonation ends the prior one", async () => {
    mockSessionReturn = platformSession();
    const first = await POST(jsonRequest({ tenantId }));
    const firstBody = await first.json();
    const firstId = firstBody.actingAs.impersonationId;

    const second = await POST(jsonRequest({ tenantId }));
    const secondBody = await second.json();
    const secondId = secondBody.actingAs.impersonationId;

    expect(secondId).not.toBe(firstId);

    const firstRow = await prisma.impersonation.findUnique({ where: { id: firstId } });
    const secondRow = await prisma.impersonation.findUnique({ where: { id: secondId } });
    expect(firstRow!.endedAt).not.toBeNull();
    expect(secondRow!.endedAt).toBeNull();
  });

  test("returns 400 on invalid JSON body", async () => {
    mockSessionReturn = platformSession();
    const req = new NextRequest("http://localhost/api/platform/impersonation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ── DELETE ────────────────────────────────────────────────

describe("DELETE /api/platform/impersonation", () => {
  test("returns 403 for non-platform-admin", async () => {
    mockSessionReturn = regularSession();
    const res = await DELETE();
    expect(res.status).toBe(403);
  });

  test("returns ended:false when no active impersonation", async () => {
    mockSessionReturn = platformSession(null);
    const res = await DELETE();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ended: false });
  });

  test("stamps endedAt and writes an end-audit when impersonating", async () => {
    // Start one first
    mockSessionReturn = platformSession();
    const startRes = await POST(jsonRequest({ tenantId }));
    const startBody = await startRes.json();
    const claim = startBody.actingAs;

    // Now end it
    mockSessionReturn = platformSession(claim);
    const endRes = await DELETE();
    expect(endRes.status).toBe(200);
    const endBody = await endRes.json();
    expect(endBody).toEqual({ ended: true });

    const row = await prisma.impersonation.findUnique({ where: { id: claim.impersonationId } });
    expect(row!.endedAt).not.toBeNull();

    await waitForAudit({ actorId: platformAdminId, action: "platform.impersonation.end" });
    const endAudits = await prisma.auditEvent.findMany({
      where: { actorId: platformAdminId, action: "platform.impersonation.end" },
    });
    expect(endAudits.length).toBe(1);
    expect(endAudits[0].entityId).toBe(claim.impersonationId);
  });
});

// ── GET ───────────────────────────────────────────────────

describe("GET /api/platform/impersonation", () => {
  test("returns 403 for non-platform-admin", async () => {
    mockSessionReturn = regularSession();
    const res = await GET();
    expect(res.status).toBe(403);
  });

  test("returns active:null when no claim on session", async () => {
    mockSessionReturn = platformSession(null);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ active: null });
  });

  test("returns the actingAs claim when present", async () => {
    const claim = {
      tenantId,
      tenantName: "X",
      tenantSlug: "x",
      role: "TENANT_ADMIN",
      impersonationId: "imp-xyz",
      startedAt: new Date().toISOString(),
    };
    mockSessionReturn = platformSession(claim);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active).toEqual(claim);
  });
});
