jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/charity/seed", () => ({ seedCharityDefaults: jest.fn() }));

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs, signOut } from "@/test-utils/session";
import { jsonRequest, readJson } from "@/test-utils/http";
import { logAudit } from "@/lib/audit";
import { seedCharityDefaults } from "@/lib/charity/seed";
import { CHARITY_FEATURE_KEY } from "@/lib/charity/feature-gate";
import { PATCH } from "@/app/api/onboarding/organisation/route";

const TENANT = "t1";

const patch = async (body: Record<string, unknown>) =>
  readJson(await PATCH(jsonRequest("PATCH", "/api/onboarding/organisation", body)));

const validBody = { country: "GB", organisationType: "CIO", financialYearEndMonth: 3, financialYearEndDay: 31 };

const charityFlagUpsert = (tenantId: string) =>
  expect.objectContaining({
    where: { tenantId_key: { tenantId, key: CHARITY_FEATURE_KEY } },
    update: { enabled: true },
  });

beforeEach(() => {
  jest.mocked(logAudit).mockClear();
  jest.mocked(seedCharityDefaults).mockClear();
  signInAs({ id: "admin-1", role: "TENANT_ADMIN", tenantId: TENANT });
  prismaMock.tenant.findUnique.mockResolvedValue({
    country: null,
    organisationType: null,
    financialYearEndMonth: null,
    financialYearEndDay: null,
    vertical: "BOWLS",
  } as never);
  prismaMock.tenant.update.mockImplementation((async ({ where, data }: any) => ({
    id: where.id,
    vertical: "BOWLS",
    ...data,
  })) as never);
  prismaMock.charitySettings.findUnique.mockResolvedValue(null);
});

describe("/api/onboarding/organisation PATCH", () => {
  test("CIO + GB enables charity feature, seeds settings, infers CC_EW", async () => {
    const { status, body } = await patch(validBody);

    expect(status).toBe(200);
    expect(body.charityEnabled).toBe(true);
    expect(body.charitySettingsSeeded).toBe(true);
    expect(body.tenant.country).toBe("GB");
    expect(body.tenant.organisationType).toBe("CIO");
    expect(body.tenant.financialYearEndMonth).toBe(3);

    expect(prismaMock.tenant.update).toHaveBeenCalledWith({
      where: { id: TENANT },
      data: { country: "GB", organisationType: "CIO", financialYearEndMonth: 3, financialYearEndDay: 31 },
    });
    expect(prismaMock.featureFlag.upsert).toHaveBeenCalledWith(charityFlagUpsert(TENANT));
    expect(prismaMock.charitySettings.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT, regulator: "CC_EW", yearEndMonth: 3, yearEndDay: 31 },
    });
    expect(seedCharityDefaults).toHaveBeenCalledWith(TENANT, "CC_EW");
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tenant.organisation.set",
        tenantId: TENANT,
        meta: expect.objectContaining({ sideEffects: { charityEnabled: true, charitySettingsSeeded: true } }),
      }),
    );
  });

  test("re-PATCH is idempotent — settings not duplicated, no re-seed", async () => {
    prismaMock.charitySettings.findUnique.mockResolvedValue({ tenantId: TENANT, regulator: "CC_EW" } as never);

    const { status, body } = await patch(validBody);

    expect(status).toBe(200);
    expect(body.charityEnabled).toBe(true);
    // Already seeded — second call should report no fresh seed.
    expect(body.charitySettingsSeeded).toBe(false);
    expect(prismaMock.charitySettings.findUnique).toHaveBeenCalledWith({ where: { tenantId: TENANT } });
    expect(prismaMock.charitySettings.create).not.toHaveBeenCalled();
    expect(seedCharityDefaults).not.toHaveBeenCalled();
  });

  test.each([
    ["SCIO", "GB", "OSCR"],
    ["CIO", "NI", "CCNI"],
  ])("%s + %s infers %s regulator", async (organisationType, country, regulator) => {
    signInAs({ id: "admin-2", role: "TENANT_ADMIN", tenantId: "t2" });

    const { status } = await patch({ country, organisationType, financialYearEndMonth: 12, financialYearEndDay: 31 });

    expect(status).toBe(200);
    expect(prismaMock.charitySettings.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: "t2", regulator }),
    });
    expect(seedCharityDefaults).toHaveBeenCalledWith("t2", regulator);
  });

  test.each([
    ["LIMITED_COMPANY + GB", { country: "GB", organisationType: "LIMITED_COMPANY" }],
    ["CIO + OTHER (unsupported jurisdiction)", { country: "OTHER", organisationType: "CIO" }],
    ["NOT_CONSTITUTED + GB (caller must constitute first)", { country: "GB", organisationType: "NOT_CONSTITUTED" }],
  ])("%s does NOT enable charity", async (_label, fields) => {
    const { status, body } = await patch({ ...fields, financialYearEndMonth: 12, financialYearEndDay: 31 });

    expect(status).toBe(200);
    expect(body.charityEnabled).toBe(false);
    expect(body.charitySettingsSeeded).toBe(false);
    expect(prismaMock.featureFlag.upsert).not.toHaveBeenCalled();
    expect(prismaMock.charitySettings.create).not.toHaveBeenCalled();
    expect(seedCharityDefaults).not.toHaveBeenCalled();
  });

  test.each([
    ["country", { country: "XX", financialYearEndMonth: 1, financialYearEndDay: 1 }],
    ["organisationType", { organisationType: "MADE_UP", financialYearEndMonth: 1, financialYearEndDay: 1 }],
    ["FY end month range", { financialYearEndMonth: 13, financialYearEndDay: 1 }],
  ])("validates %s", async (_label, fields) => {
    const { status } = await patch({ ...validBody, ...fields });

    expect(status).toBe(400);
    expect(prismaMock.tenant.update).not.toHaveBeenCalled();
  });

  test("rejects USER role", async () => {
    signInAs({ id: "x", role: "USER", tenantId: TENANT });

    const { status } = await patch(validBody);

    expect(status).toBe(403);
    expect(prismaMock.tenant.update).not.toHaveBeenCalled();
  });

  test("rejects unauthenticated callers", async () => {
    signOut();

    const { status } = await patch(validBody);

    expect(status).toBe(401);
    expect(prismaMock.tenant.update).not.toHaveBeenCalled();
  });
});
