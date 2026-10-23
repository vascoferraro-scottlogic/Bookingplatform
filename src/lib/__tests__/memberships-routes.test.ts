jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, request } from "@/test-utils/http";
import { GET as listMemberships } from "@/app/api/auth/memberships/route";
import { POST as switchTenant } from "@/app/api/auth/memberships/active/route";

const USER = { id: "mb-user", role: "USER" as const, tenantId: "tenant-a" };

const membership = (tenantId: string, tenantStatus: string) => ({
  id: `m-${tenantId}`,
  userId: USER.id,
  tenantId,
  role: "USER",
  kind: "MEMBER",
  status: "ACTIVE",
  createdAt: new Date(),
  tenant: { id: tenantId, name: tenantId, slug: tenantId, brandColor: "#000", status: tenantStatus, active: tenantStatus === "ACTIVE", locale: "en" },
});

beforeEach(() => signInAs(USER));

describe("/api/auth/memberships", () => {
  test("[B-17] D-08 – the list leaves out clubs that are SUSPENDED or CHURNED", async () => {
    prismaMock.membership.findMany.mockResolvedValue([
      membership("tenant-a", "ACTIVE"),
      membership("tenant-b", "SUSPENDED"),
      membership("tenant-c", "CHURNED"),
    ] as never);

    const { status, body } = await readJson(await listMemberships(request("/api/auth/memberships")));

    expect(status).toBe(200);
    expect(body.map((m: any) => m.tenantId)).toEqual(["tenant-a"]);
  });

  test.each(["SUSPENDED", "CHURNED"])("[B-17] D-08 – switching to a %s club is refused (403)", async (tenantStatus) => {
    prismaMock.membership.findUnique.mockResolvedValue(membership("tenant-b", tenantStatus) as never);

    const { status } = await readJson(await switchTenant(jsonRequest("POST", "/api/auth/memberships/active", { tenantId: "tenant-b" })));

    expect(status).toBe(403);
  });

  test("switching to an ACTIVE club with an active membership is allowed", async () => {
    prismaMock.membership.findUnique.mockResolvedValue(membership("tenant-b", "ACTIVE") as never);

    const { status } = await readJson(await switchTenant(jsonRequest("POST", "/api/auth/memberships/active", { tenantId: "tenant-b" })));

    expect(status).toBe(200);
  });
});
