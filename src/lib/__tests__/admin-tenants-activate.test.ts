jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, routeParams } from "@/test-utils/http";
import { logAudit } from "@/lib/audit";
import { PATCH } from "@/app/api/admin/tenants/[id]/route";

const patchTenant = async (id: string, body: Record<string, unknown>) =>
  readJson(await PATCH(jsonRequest("PATCH", `/api/admin/tenants/${id}`, body), routeParams({ id })));

function givenTenantStatus(status: "ONBOARDING" | "SUSPENDED" | "ACTIVE") {
  prismaMock.tenant.findUnique.mockResolvedValue({ status } as never);
}

beforeEach(() => {
  jest.mocked(logAudit).mockClear();
  signInAs({ id: "pa-1", role: "PLATFORM_ADMIN", tenantId: null });
  prismaMock.tenant.update.mockImplementation((async ({ where, data }: any) => ({ id: where.id, ...data })) as never);
});

describe("PATCH /api/admin/tenants/[id] — activate guard", () => {
  test("rejects { active: true } on ONBOARDING tenant with 409", async () => {
    givenTenantStatus("ONBOARDING");

    const { status, body } = await patchTenant("t-onb", { active: true });

    expect(status).toBe(409);
    expect(body.error).toMatch(/go-live/i);
    expect(prismaMock.tenant.findUnique).toHaveBeenCalledWith({ where: { id: "t-onb" }, select: { status: true } });
    expect(prismaMock.tenant.update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  test("activating a SUSPENDED tenant flips status=ACTIVE and active=true", async () => {
    givenTenantStatus("SUSPENDED");

    const { status, body } = await patchTenant("t-susp", { active: true });

    expect(status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ status: "ACTIVE", active: true }));
    expect(prismaMock.tenant.update).toHaveBeenCalledWith({
      where: { id: "t-susp" },
      data: { active: true, status: "ACTIVE" },
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.tenant.activated", tenantId: "t-susp" }),
    );
  });

  test("deactivating an ACTIVE tenant flips status=SUSPENDED and active=false", async () => {
    givenTenantStatus("ACTIVE");

    const { status, body } = await patchTenant("t-act", { active: false });

    expect(status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ status: "SUSPENDED", active: false }));
    expect(prismaMock.tenant.update).toHaveBeenCalledWith({
      where: { id: "t-act" },
      data: { active: false, status: "SUSPENDED" },
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.tenant.deactivated", tenantId: "t-act" }),
    );
  });
});
