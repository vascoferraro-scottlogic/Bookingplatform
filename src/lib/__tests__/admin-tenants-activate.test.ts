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

import { PATCH } from "@/app/api/admin/tenants/[id]/route";

let onboardingTenantId: string;
let suspendedTenantId: string;
let activeTenantId: string;
let platformAdminId: string;
const cleanup: { tenantIds: string[]; userIds: string[] } = { tenantIds: [], userIds: [] };

function platformAdminSession() {
  return {
    session: {
      user: {
        id: platformAdminId,
        email: "platform@admin.test",
        name: "Platform Admin",
        role: "PLATFORM_ADMIN",
        tenantId: null,
        actingAs: null,
      },
    },
  };
}

function patchReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/tenants/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const stamp = Date.now();
  const onboarding = await prisma.tenant.create({
    data: { name: "Onb Test Club", slug: `at-onb-${stamp}`, status: "ONBOARDING", active: false },
  });
  onboardingTenantId = onboarding.id;
  cleanup.tenantIds.push(onboarding.id);

  const suspended = await prisma.tenant.create({
    data: { name: "Susp Test Club", slug: `at-susp-${stamp}`, status: "SUSPENDED", active: false },
  });
  suspendedTenantId = suspended.id;
  cleanup.tenantIds.push(suspended.id);

  const active = await prisma.tenant.create({
    data: { name: "Active Test Club", slug: `at-act-${stamp}`, status: "ACTIVE", active: true },
  });
  activeTenantId = active.id;
  cleanup.tenantIds.push(active.id);

  const admin = await prisma.user.create({
    data: { email: `at-pa-${stamp}@test.com`, name: "PA", passwordHash: "x", role: "PLATFORM_ADMIN" },
  });
  platformAdminId = admin.id;
  cleanup.userIds.push(admin.id);
});

afterAll(async () => {
  try {
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: cleanup.userIds } } });
    await prisma.auditEvent.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
    await prisma.user.updateMany({ where: { tenantId: { in: cleanup.tenantIds } }, data: { tenantId: null } });
    await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: cleanup.tenantIds } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("PATCH /api/admin/tenants/[id] — activate guard", () => {
  beforeEach(() => {
    mockSessionReturn = platformAdminSession();
  });

  test("rejects { active: true } on ONBOARDING tenant with 409", async () => {
    const res = await PATCH(patchReq({ active: true }), { params: Promise.resolve({ id: onboardingTenantId }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/go-live/i);

    const after = await prisma.tenant.findUnique({ where: { id: onboardingTenantId }, select: { status: true, active: true } });
    expect(after?.status).toBe("ONBOARDING");
    expect(after?.active).toBe(false);
  });

  test("activating a SUSPENDED tenant flips status=ACTIVE and active=true", async () => {
    const res = await PATCH(patchReq({ active: true }), { params: Promise.resolve({ id: suspendedTenantId }) });
    expect(res.status).toBe(200);
    const after = await prisma.tenant.findUnique({ where: { id: suspendedTenantId }, select: { status: true, active: true } });
    expect(after?.status).toBe("ACTIVE");
    expect(after?.active).toBe(true);
  });

  test("deactivating an ACTIVE tenant flips status=SUSPENDED and active=false", async () => {
    const res = await PATCH(patchReq({ active: false }), { params: Promise.resolve({ id: activeTenantId }) });
    expect(res.status).toBe(200);
    const after = await prisma.tenant.findUnique({ where: { id: activeTenantId }, select: { status: true, active: true } });
    expect(after?.status).toBe("SUSPENDED");
    expect(after?.active).toBe(false);
  });
});
