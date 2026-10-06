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

import { GET, PATCH } from "@/app/api/onboarding/slug/route";

let tenantId: string;
let otherTenantId: string;
let liveTenantId: string;
let tenantAdminId: string;
let liveAdminId: string;
const cleanup: { tenantIds: string[]; userIds: string[] } = { tenantIds: [], userIds: [] };

function adminSession(forTenant: string, userId: string) {
  return {
    session: {
      user: {
        id: userId,
        email: "slug-admin@test.com",
        name: "Slug Admin",
        role: "TENANT_ADMIN",
        tenantId: forTenant,
        actingAs: null,
      },
    },
  };
}

function patchReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/onboarding/slug", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getReq(candidate?: string) {
  const url = candidate
    ? `http://localhost/api/onboarding/slug?candidate=${encodeURIComponent(candidate)}`
    : "http://localhost/api/onboarding/slug";
  return new NextRequest(url);
}

beforeAll(async () => {
  const stamp = Date.now();
  const t = await prisma.tenant.create({
    data: { name: "Slug Test Club", slug: `t-${stamp.toString(16).slice(-8)}`, status: "ONBOARDING", active: false },
  });
  tenantId = t.id;
  cleanup.tenantIds.push(t.id);

  const other = await prisma.tenant.create({
    data: { name: "Other Club", slug: `slug-other-${stamp}`, status: "ACTIVE", active: true },
  });
  otherTenantId = other.id;
  cleanup.tenantIds.push(other.id);

  const live = await prisma.tenant.create({
    data: {
      name: "Live Club",
      slug: `slug-live-${stamp}`,
      status: "ACTIVE",
      active: true,
      goLiveAt: new Date(),
    },
  });
  liveTenantId = live.id;
  cleanup.tenantIds.push(live.id);

  const admin = await prisma.user.create({
    data: { email: `slug-admin-${stamp}@test.com`, name: "Slug Admin", passwordHash: "x", role: "TENANT_ADMIN", tenantId },
  });
  tenantAdminId = admin.id;
  cleanup.userIds.push(admin.id);

  const liveAdmin = await prisma.user.create({
    data: { email: `slug-live-admin-${stamp}@test.com`, name: "Live Admin", passwordHash: "x", role: "TENANT_ADMIN", tenantId: liveTenantId },
  });
  liveAdminId = liveAdmin.id;
  cleanup.userIds.push(liveAdmin.id);
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: cleanup.userIds } } });
  await prisma.user.updateMany({ where: { tenantId: { in: cleanup.tenantIds } }, data: { tenantId: null } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: cleanup.tenantIds } } });
  await prisma.$disconnect();
});

describe("/api/onboarding/slug", () => {
  beforeEach(() => {
    mockSessionReturn = adminSession(tenantId, tenantAdminId);
  });

  describe("GET (availability check)", () => {
    test("reports available for a fresh valid slug", async () => {
      const res = await GET(getReq("my-fresh-club"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.available).toBe(true);
      expect(body.slug).toBe("my-fresh-club");
    });

    test("reports unavailable for a reserved slug", async () => {
      const res = await GET(getReq("dashboard"));
      const body = await res.json();
      expect(body.available).toBe(false);
      expect(body.reason).toMatch(/reserved/i);
    });

    test("reports unavailable for a taken slug", async () => {
      const other = await prisma.tenant.findUnique({ where: { id: otherTenantId } });
      const res = await GET(getReq(other!.slug));
      const body = await res.json();
      expect(body.available).toBe(false);
      expect(body.reason).toMatch(/taken/i);
    });

    test("rejects invalid format (leading hyphen, too short, illegal chars)", async () => {
      const a = await (await GET(getReq("-leading"))).json();
      expect(a.available).toBe(false);
      const b = await (await GET(getReq("ab"))).json();
      expect(b.available).toBe(false);
      const c = await (await GET(getReq("bad slug"))).json();
      expect(c.available).toBe(false);
    });

    test("rejects consecutive hyphens", async () => {
      const body = await (await GET(getReq("foo--bar"))).json();
      expect(body.available).toBe(false);
      expect(body.reason).toMatch(/hyphen/i);
    });
  });

  describe("PATCH (set slug)", () => {
    test("sets a valid slug on an onboarding tenant", async () => {
      const stamp = Date.now();
      const candidate = `chosen-${stamp}`;
      const res = await PATCH(patchReq({ slug: candidate }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.slug).toBe(candidate);

      const refreshed = await prisma.tenant.findUnique({ where: { id: tenantId } });
      expect(refreshed?.slug).toBe(candidate);
    });

    test("rejects a reserved slug", async () => {
      const res = await PATCH(patchReq({ slug: "api" }));
      expect(res.status).toBe(400);
    });

    test("rejects a slug already taken by another tenant", async () => {
      const other = await prisma.tenant.findUnique({ where: { id: otherTenantId } });
      const res = await PATCH(patchReq({ slug: other!.slug }));
      expect(res.status).toBe(409);
    });

    test("rejects invalid format", async () => {
      const res = await PATCH(patchReq({ slug: "BAD!" }));
      expect(res.status).toBe(400);
    });

    test("is locked once tenant has gone live", async () => {
      mockSessionReturn = adminSession(liveTenantId, liveAdminId);
      const res = await PATCH(patchReq({ slug: `attempted-${Date.now()}` }));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toMatch(/locked/i);
    });
  });
});
