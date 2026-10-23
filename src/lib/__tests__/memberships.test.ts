jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { hoursFromNow } from "@/test-utils/dates";
import { resolveActiveContext, getActiveMembershipsForUser, pickPrimaryMembership } from "@/lib/memberships";

const USER_ID = "mb-user";
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

function membership(tenantId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `m-${tenantId}`,
    userId: USER_ID,
    tenantId,
    role: "USER",
    kind: "MEMBER",
    status: "ACTIVE",
    createdAt: hoursFromNow(-48),
    tenant: { id: tenantId, name: tenantId, slug: tenantId, brandColor: "#000", status: "ACTIVE", active: true, locale: "en" },
    ...overrides,
  };
}

// The query orders by createdAt asc, so the mock returns rows in that order:
// A first (the primary), then B as a MAINTENANCE contractor (multi-club user).
function givenMemberships(bStatus: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
  prismaMock.membership.findMany.mockResolvedValue([
    membership(TENANT_A),
    membership(TENANT_B, { role: "MAINTENANCE", kind: "CONTRACTOR", status: bStatus, createdAt: hoursFromNow(-24) }),
  ] as never);
}

describe("memberships helpers", () => {
  test("getActiveMembershipsForUser returns both clubs", async () => {
    givenMemberships();
    const list = await getActiveMembershipsForUser(USER_ID);
    expect(list).toHaveLength(2);
    const ids = list.map((m) => m.tenantId);
    expect(ids).toContain(TENANT_A);
    expect(ids).toContain(TENANT_B);
  });

  test("memberships are fetched for the user, oldest first", async () => {
    givenMemberships();
    await getActiveMembershipsForUser(USER_ID);
    expect(prismaMock.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID }, orderBy: { createdAt: "asc" } }),
    );
  });

  test("getActiveMembershipsForUser drops non-ACTIVE memberships", async () => {
    givenMemberships("SUSPENDED");
    const list = await getActiveMembershipsForUser(USER_ID);
    expect(list.map((m) => m.tenantId)).toEqual([TENANT_A]);
  });

  test("pickPrimaryMembership returns the lowest-createdAt active", async () => {
    givenMemberships();
    const list = await getActiveMembershipsForUser(USER_ID);
    const primary = pickPrimaryMembership(list);
    expect(primary?.tenantId).toBe(TENANT_A);
  });

  test("resolveActiveContext honours preferredTenantId when active", async () => {
    givenMemberships();
    const ctx = await resolveActiveContext(USER_ID, TENANT_B);
    expect(ctx.tenantId).toBe(TENANT_B);
    expect(ctx.role).toBe("MAINTENANCE");
    expect(ctx.kind).toBe("CONTRACTOR");
  });

  test("resolveActiveContext falls back to primary when preferred is invalid", async () => {
    givenMemberships();
    const ctx = await resolveActiveContext(USER_ID, "nonexistent-tenant-id");
    expect(ctx.tenantId).toBe(TENANT_A);
  });

  test("resolveActiveContext returns nulls for users with no memberships", async () => {
    prismaMock.membership.findMany.mockResolvedValue([]);
    const ctx = await resolveActiveContext("orphan-user", null);
    expect(ctx.tenantId).toBeNull();
  });

  test("resolveActiveContext skips suspended memberships when picking preferred", async () => {
    // B suspended; preferred B should fall through to primary A
    givenMemberships("SUSPENDED");
    const ctx = await resolveActiveContext(USER_ID, TENANT_B);
    expect(ctx.tenantId).toBe(TENANT_A);
  });
});
