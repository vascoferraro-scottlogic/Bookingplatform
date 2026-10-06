import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import { CHARITY_FEATURE_KEY } from "@/lib/charity/feature-gate";

let mockSessionReturn: any;

jest.mock("@/lib/api-utils", () => {
  const actual = jest.requireActual("@/lib/api-utils");
  return {
    ...actual,
    getSessionOrFail: jest.fn(() => Promise.resolve(mockSessionReturn)),
  };
});

import { PATCH } from "@/app/api/onboarding/organisation/route";

let tenantId: string;
let tenantAdminId: string;
const cleanup: { tenantIds: string[]; userIds: string[] } = { tenantIds: [], userIds: [] };

function adminSession() {
  return {
    session: {
      user: {
        id: tenantAdminId,
        email: "org-admin@test.com",
        name: "Org Admin",
        role: "TENANT_ADMIN",
        tenantId,
        actingAs: null,
      },
    },
  };
}

function patchReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/onboarding/organisation", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function makeTenant(slugSuffix: string) {
  const stamp = Date.now();
  const tenant = await prisma.tenant.create({
    data: {
      name: `Org Test ${slugSuffix}`,
      slug: `org-test-${slugSuffix}-${stamp}`,
      status: "ONBOARDING",
      active: false,
    },
  });
  cleanup.tenantIds.push(tenant.id);
  return tenant.id;
}

beforeAll(async () => {
  tenantId = await makeTenant("primary");

  const stamp = Date.now();
  const admin = await prisma.user.create({
    data: {
      email: `org-admin-${stamp}@test.com`,
      name: "Org Admin",
      passwordHash: "x",
      role: "TENANT_ADMIN",
      tenantId,
    },
  });
  tenantAdminId = admin.id;
  cleanup.userIds.push(admin.id);
});

afterAll(async () => {
  const tids = { in: cleanup.tenantIds };
  await prisma.charityCategory.deleteMany({ where: { tenantId: tids } });
  await prisma.charitySettings.deleteMany({ where: { tenantId: tids } });
  await prisma.featureFlag.deleteMany({ where: { tenantId: tids } });
  await prisma.auditEvent.deleteMany({ where: { tenantId: tids } });
  await prisma.user.updateMany({ where: { tenantId: tids }, data: { tenantId: null } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.tenant.deleteMany({ where: { id: tids } });
  await prisma.$disconnect();
});

describe("/api/onboarding/organisation PATCH", () => {
  beforeEach(() => {
    mockSessionReturn = adminSession();
  });

  test("CIO + GB enables charity feature, seeds settings, infers CC_EW", async () => {
    const res = await PATCH(
      patchReq({
        country: "GB",
        organisationType: "CIO",
        financialYearEndMonth: 3,
        financialYearEndDay: 31,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.charityEnabled).toBe(true);
    expect(body.charitySettingsSeeded).toBe(true);
    expect(body.tenant.country).toBe("GB");
    expect(body.tenant.organisationType).toBe("CIO");
    expect(body.tenant.financialYearEndMonth).toBe(3);

    const flag = await prisma.featureFlag.findUnique({
      where: { tenantId_key: { tenantId, key: CHARITY_FEATURE_KEY } },
    });
    expect(flag?.enabled).toBe(true);

    const settings = await prisma.charitySettings.findUnique({ where: { tenantId } });
    expect(settings?.regulator).toBe("CC_EW");
    expect(settings?.yearEndMonth).toBe(3);

    const cats = await prisma.charityCategory.count({ where: { tenantId } });
    expect(cats).toBeGreaterThan(0);
  });

  test("re-PATCH is idempotent — settings not duplicated, no re-seed", async () => {
    const beforeCats = await prisma.charityCategory.count({ where: { tenantId } });
    const res = await PATCH(
      patchReq({
        country: "GB",
        organisationType: "CIO",
        financialYearEndMonth: 3,
        financialYearEndDay: 31,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Already seeded — second call should report no fresh seed.
    expect(body.charitySettingsSeeded).toBe(false);

    const afterCats = await prisma.charityCategory.count({ where: { tenantId } });
    expect(afterCats).toBe(beforeCats);

    const settingsCount = await prisma.charitySettings.count({ where: { tenantId } });
    expect(settingsCount).toBe(1);
  });

  test("SCIO infers OSCR regulator", async () => {
    const localTenantId = await makeTenant("scio");
    mockSessionReturn = {
      session: {
        user: {
          id: tenantAdminId,
          email: "x@x.com",
          name: "X",
          role: "TENANT_ADMIN",
          tenantId: localTenantId,
          actingAs: null,
        },
      },
    };
    const res = await PATCH(
      patchReq({
        country: "GB",
        organisationType: "SCIO",
        financialYearEndMonth: 12,
        financialYearEndDay: 31,
      }),
    );
    expect(res.status).toBe(200);
    const settings = await prisma.charitySettings.findUnique({
      where: { tenantId: localTenantId },
    });
    expect(settings?.regulator).toBe("OSCR");
  });

  test("NI + CIO infers CCNI regulator", async () => {
    const localTenantId = await makeTenant("ni");
    mockSessionReturn = {
      session: {
        user: {
          id: tenantAdminId,
          email: "x@x.com",
          name: "X",
          role: "TENANT_ADMIN",
          tenantId: localTenantId,
          actingAs: null,
        },
      },
    };
    const res = await PATCH(
      patchReq({
        country: "NI",
        organisationType: "CIO",
        financialYearEndMonth: 6,
        financialYearEndDay: 30,
      }),
    );
    expect(res.status).toBe(200);
    const settings = await prisma.charitySettings.findUnique({
      where: { tenantId: localTenantId },
    });
    expect(settings?.regulator).toBe("CCNI");
  });

  test("LIMITED_COMPANY + GB does NOT enable charity", async () => {
    const localTenantId = await makeTenant("ltd");
    mockSessionReturn = {
      session: {
        user: {
          id: tenantAdminId,
          email: "x@x.com",
          name: "X",
          role: "TENANT_ADMIN",
          tenantId: localTenantId,
          actingAs: null,
        },
      },
    };
    const res = await PATCH(
      patchReq({
        country: "GB",
        organisationType: "LIMITED_COMPANY",
        financialYearEndMonth: 12,
        financialYearEndDay: 31,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.charityEnabled).toBe(false);

    const flag = await prisma.featureFlag.findUnique({
      where: { tenantId_key: { tenantId: localTenantId, key: CHARITY_FEATURE_KEY } },
    });
    expect(flag?.enabled ?? false).toBe(false);

    const settings = await prisma.charitySettings.findUnique({ where: { tenantId: localTenantId } });
    expect(settings).toBeNull();
  });

  test("CIO + OTHER (unsupported jurisdiction) does NOT enable charity", async () => {
    const localTenantId = await makeTenant("other");
    mockSessionReturn = {
      session: {
        user: {
          id: tenantAdminId,
          email: "x@x.com",
          name: "X",
          role: "TENANT_ADMIN",
          tenantId: localTenantId,
          actingAs: null,
        },
      },
    };
    const res = await PATCH(
      patchReq({
        country: "OTHER",
        organisationType: "CIO",
        financialYearEndMonth: 12,
        financialYearEndDay: 31,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.charityEnabled).toBe(false);

    const settings = await prisma.charitySettings.findUnique({ where: { tenantId: localTenantId } });
    expect(settings).toBeNull();
  });

  test("NOT_CONSTITUTED + GB does NOT enable charity (caller must constitute first)", async () => {
    const localTenantId = await makeTenant("notc");
    mockSessionReturn = {
      session: {
        user: {
          id: tenantAdminId,
          email: "x@x.com",
          name: "X",
          role: "TENANT_ADMIN",
          tenantId: localTenantId,
          actingAs: null,
        },
      },
    };
    const res = await PATCH(
      patchReq({
        country: "GB",
        organisationType: "NOT_CONSTITUTED",
        financialYearEndMonth: 12,
        financialYearEndDay: 31,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.charityEnabled).toBe(false);
  });

  test("validates country", async () => {
    const res = await PATCH(
      patchReq({ country: "XX", organisationType: "CIO", financialYearEndMonth: 1, financialYearEndDay: 1 }),
    );
    expect(res.status).toBe(400);
  });

  test("validates organisationType", async () => {
    const res = await PATCH(
      patchReq({ country: "GB", organisationType: "MADE_UP", financialYearEndMonth: 1, financialYearEndDay: 1 }),
    );
    expect(res.status).toBe(400);
  });

  test("validates FY end month range", async () => {
    const res = await PATCH(
      patchReq({ country: "GB", organisationType: "CIO", financialYearEndMonth: 13, financialYearEndDay: 1 }),
    );
    expect(res.status).toBe(400);
  });

  test("rejects USER role", async () => {
    mockSessionReturn = {
      session: {
        user: { id: "x", email: "u@u.com", role: "USER", tenantId, actingAs: null },
      },
    };
    const res = await PATCH(
      patchReq({ country: "GB", organisationType: "CIO", financialYearEndMonth: 3, financialYearEndDay: 31 }),
    );
    expect(res.status).toBe(403);
  });

  test("rejects unauthenticated callers", async () => {
    mockSessionReturn = {
      error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    };
    const res = await PATCH(
      patchReq({ country: "GB", organisationType: "CIO", financialYearEndMonth: 3, financialYearEndDay: 31 }),
    );
    expect(res.status).toBe(401);
  });
});
