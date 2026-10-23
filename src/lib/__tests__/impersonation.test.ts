jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, request, readJson } from "@/test-utils/http";
import type { ActingAsClaim } from "@/lib/roles";
import { GET, POST, DELETE } from "@/app/api/platform/impersonation/route";

const PLATFORM_ADMIN_ID = "platform-admin";
const TENANT = { id: "tenant-1", name: "Impersonation Test Club", slug: "imp-test", active: true, status: "ACTIVE" };
const SUSPENDED_TENANT = { id: "tenant-2", name: "Inactive Club", slug: "imp-inactive", active: false, status: "SUSPENDED" };

const signInAsPlatformAdmin = (actingAs: ActingAsClaim | null = null) =>
  signInAs({ id: PLATFORM_ADMIN_ID, role: "PLATFORM_ADMIN", tenantId: null, actingAs });
const signInAsRegularUser = () => signInAs({ id: "regular-user", role: "USER", tenantId: TENANT.id });

const start = (body: Record<string, unknown>) => POST(jsonRequest("POST", "/api/platform/impersonation", body));

beforeEach(() => {
  prismaMock.tenant.findUnique.mockImplementation((async ({ where }: any) =>
    [TENANT, SUSPENDED_TENANT].find((t) => t.id === where.id) ?? null) as never);
  prismaMock.impersonation.create.mockImplementation((async ({ data }: any) => ({
    id: "imp-1",
    startedAt: new Date(),
    endedAt: null,
    ...data,
  })) as never);
  prismaMock.auditEvent.create.mockResolvedValue({} as never);
});

function auditCalls(action: string) {
  return prismaMock.auditEvent.create.mock.calls
    .map(([arg]) => (arg as any).data)
    .filter((d) => d.action === action);
}

// ── POST ──────────────────────────────────────────────────

describe("POST /api/platform/impersonation", () => {
  test("returns 403 when caller is not PLATFORM_ADMIN", async () => {
    signInAsRegularUser();
    const res = await start({ tenantId: TENANT.id });
    expect(res.status).toBe(403);
    expect(prismaMock.impersonation.create).not.toHaveBeenCalled();
  });

  test("returns 400 when tenantId missing", async () => {
    signInAsPlatformAdmin();
    const res = await start({});
    expect(res.status).toBe(400);
    expect(prismaMock.impersonation.create).not.toHaveBeenCalled();
  });

  test("returns 404 when tenant does not exist", async () => {
    signInAsPlatformAdmin();
    const res = await start({ tenantId: "no-such-tenant" });
    expect(res.status).toBe(404);
    expect(prismaMock.impersonation.create).not.toHaveBeenCalled();
  });

  test("returns 400 when tenant is SUSPENDED", async () => {
    signInAsPlatformAdmin();
    const res = await start({ tenantId: SUSPENDED_TENANT.id });
    expect(res.status).toBe(400);
    expect(prismaMock.impersonation.create).not.toHaveBeenCalled();
  });

  test("creates Impersonation row and returns actingAs claim", async () => {
    signInAsPlatformAdmin();
    const { status, body } = await readJson(await start({ tenantId: TENANT.id, reason: "Investigating booking issue" }));
    expect(status).toBe(200);
    expect(body.actingAs).toMatchObject({
      tenantId: TENANT.id,
      role: "TENANT_ADMIN",
    });
    expect(body.actingAs.impersonationId).toBe("imp-1");
    expect(body.actingAs.tenantName).toBe("Impersonation Test Club");

    expect(prismaMock.impersonation.create).toHaveBeenCalledWith({
      data: {
        platformUserId: PLATFORM_ADMIN_ID,
        tenantId: TENANT.id,
        assumedRole: "TENANT_ADMIN",
        reason: "Investigating booking issue",
      },
    });
  });

  test("writes a platform.impersonation.start audit event", async () => {
    signInAsPlatformAdmin();
    const { body } = await readJson(await start({ tenantId: TENANT.id }));

    const audits = auditCalls("platform.impersonation.start");
    expect(audits).toHaveLength(1);
    expect(audits[0].actorId).toBe(PLATFORM_ADMIN_ID);
    expect(audits[0].entityId).toBe(body.actingAs.impersonationId);
    expect(audits[0].tenantId).toBe(TENANT.id);
  });

  test("starting an impersonation ends the caller's prior open ones first", async () => {
    signInAsPlatformAdmin();
    await start({ tenantId: TENANT.id });

    expect(prismaMock.impersonation.updateMany).toHaveBeenCalledWith({
      where: { platformUserId: PLATFORM_ADMIN_ID, endedAt: null },
      data: { endedAt: expect.any(Date) },
    });
    const endedOrder = prismaMock.impersonation.updateMany.mock.invocationCallOrder[0];
    const createdOrder = prismaMock.impersonation.create.mock.invocationCallOrder[0];
    expect(endedOrder).toBeLessThan(createdOrder);
  });

  test("returns 400 on invalid JSON body", async () => {
    signInAsPlatformAdmin();
    const req = request("/api/platform/impersonation", {
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
  const claim: ActingAsClaim = {
    tenantId: TENANT.id,
    tenantName: TENANT.name,
    tenantSlug: TENANT.slug,
    role: "TENANT_ADMIN",
    impersonationId: "imp-1",
    startedAt: new Date().toISOString(),
  };

  test("returns 403 for non-platform-admin", async () => {
    signInAsRegularUser();
    const res = await DELETE();
    expect(res.status).toBe(403);
  });

  test("returns ended:false when no active impersonation", async () => {
    signInAsPlatformAdmin(null);
    const { status, body } = await readJson(await DELETE());
    expect(status).toBe(200);
    expect(body).toEqual({ ended: false });
    expect(prismaMock.impersonation.updateMany).not.toHaveBeenCalled();
  });

  test("stamps endedAt and writes an end-audit when impersonating", async () => {
    signInAsPlatformAdmin(claim);
    const { status, body } = await readJson(await DELETE());
    expect(status).toBe(200);
    expect(body).toEqual({ ended: true });

    expect(prismaMock.impersonation.updateMany).toHaveBeenCalledWith({
      where: { id: claim.impersonationId, platformUserId: PLATFORM_ADMIN_ID, endedAt: null },
      data: { endedAt: expect.any(Date) },
    });

    const endAudits = auditCalls("platform.impersonation.end");
    expect(endAudits).toHaveLength(1);
    expect(endAudits[0].actorId).toBe(PLATFORM_ADMIN_ID);
    expect(endAudits[0].entityId).toBe(claim.impersonationId);
  });
});

// ── GET ───────────────────────────────────────────────────

describe("GET /api/platform/impersonation", () => {
  test("returns 403 for non-platform-admin", async () => {
    signInAsRegularUser();
    const res = await GET();
    expect(res.status).toBe(403);
  });

  test("returns active:null when no claim on session", async () => {
    signInAsPlatformAdmin(null);
    const { status, body } = await readJson(await GET());
    expect(status).toBe(200);
    expect(body).toEqual({ active: null });
  });

  test("returns the actingAs claim when present", async () => {
    const claim: ActingAsClaim = {
      tenantId: TENANT.id,
      tenantName: "X",
      tenantSlug: "x",
      role: "TENANT_ADMIN",
      impersonationId: "imp-xyz",
      startedAt: new Date().toISOString(),
    };
    signInAsPlatformAdmin(claim);
    const { status, body } = await readJson(await GET());
    expect(status).toBe(200);
    expect(body.active).toEqual(claim);
  });
});
