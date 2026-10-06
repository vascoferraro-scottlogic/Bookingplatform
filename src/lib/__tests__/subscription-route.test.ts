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

import { GET, POST } from "@/app/api/onboarding/subscription/route";

let tenantId: string;
let tenantAdminId: string;
const cleanup: { tenantIds: string[]; userIds: string[] } = { tenantIds: [], userIds: [] };

function adminSession() {
  return {
    session: {
      user: {
        id: tenantAdminId,
        email: "sub-admin@test.com",
        name: "Sub Admin",
        role: "TENANT_ADMIN",
        tenantId,
        actingAs: null,
      },
    },
  };
}

beforeAll(async () => {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: { name: "Sub Test Club", slug: `sub-test-${stamp}`, status: "ONBOARDING", active: false },
  });
  tenantId = tenant.id;
  cleanup.tenantIds.push(tenant.id);

  const admin = await prisma.user.create({
    data: { email: `sub-admin-${stamp}@test.com`, name: "Sub Admin", passwordHash: "x", role: "TENANT_ADMIN", tenantId },
  });
  tenantAdminId = admin.id;
  cleanup.userIds.push(admin.id);
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: cleanup.userIds } } });
  await prisma.onboardingProgress.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.tenantBillingProfile.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.user.updateMany({ where: { tenantId: { in: cleanup.tenantIds } }, data: { tenantId: null } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: cleanup.tenantIds } } });
  await prisma.$disconnect();
});

describe("/api/onboarding/subscription", () => {
  beforeEach(() => {
    mockSessionReturn = adminSession();
  });

  test("GET reports not-attested initially", async () => {
    await prisma.onboardingProgress.deleteMany({ where: { tenantId } });
    const res = await GET(new NextRequest("http://localhost/api/onboarding/subscription"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attested).toBe(false);
    expect(body.attestedAt).toBeNull();
  });

  test("POST sets the timestamp and audits", async () => {
    await prisma.onboardingProgress.deleteMany({ where: { tenantId } });
    await prisma.auditEvent.deleteMany({ where: { tenantId } });

    const res = await POST(new NextRequest("http://localhost/api/onboarding/subscription", { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attested).toBe(true);
    expect(body.attestedAt).toBeTruthy();

    const progress = await prisma.onboardingProgress.findUnique({ where: { tenantId } });
    expect(progress?.subscriptionAttestedAt).toBeTruthy();

    // give the fire-and-forget audit a tick to land
    await new Promise((r) => setTimeout(r, 50));
    const audits = await prisma.auditEvent.findMany({
      where: { tenantId, action: "onboarding.subscription.attested" },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  test("POST is idempotent (re-attesting is a no-op)", async () => {
    // From previous test, attestation is set.
    const before = await prisma.onboardingProgress.findUnique({ where: { tenantId } });
    expect(before?.subscriptionAttestedAt).toBeTruthy();
    const firstTimestamp = before!.subscriptionAttestedAt!.toISOString();

    const res = await POST(new NextRequest("http://localhost/api/onboarding/subscription", { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attested).toBe(true);
    expect(body.unchanged).toBe(true);

    const after = await prisma.onboardingProgress.findUnique({ where: { tenantId } });
    expect(after!.subscriptionAttestedAt!.toISOString()).toBe(firstTimestamp);
  });

  test("GET reports attested once set", async () => {
    const res = await GET(new NextRequest("http://localhost/api/onboarding/subscription"));
    const body = await res.json();
    expect(body.attested).toBe(true);
    expect(body.attestedAt).toBeTruthy();
  });
});
