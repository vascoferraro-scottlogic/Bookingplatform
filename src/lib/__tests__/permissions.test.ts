jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import {
  assertPermissionOrFail,
  hasPermission,
  getEffectivePermissions,
  ALL_PERMISSIONS,
} from "@/lib/permissions";
import type { AppSession } from "@/lib/api-utils";

function makeSession(overrides: Partial<AppSession["user"]>): AppSession {
  return {
    user: {
      id: "u-test",
      email: "test@example.com",
      name: "Test",
      role: "USER",
      tenantId: null,
      ...overrides,
    },
  };
}

const TENANT_ID = "tenant-1";
const USER_ID = "perm-user";
// The user's only group in TENANT_ID grants these two permissions.
const GROUP_GRANTS = ["bookings_view", "bookings_create"];

beforeEach(() => {
  // groupMember.findFirst finds a row only for USER_ID in TENANT_ID when the
  // requested permission is one of the group's grants.
  prismaMock.groupMember.findFirst.mockImplementation((async ({ where }: any) => {
    const ok =
      where.membership.userId === USER_ID &&
      where.membership.tenantId === TENANT_ID &&
      where.group.tenantId === TENANT_ID &&
      GROUP_GRANTS.includes(where.group.grants.some.permission);
    return ok ? { id: "gm-1" } : null;
  }) as never);
  prismaMock.permissionGrant.findMany.mockImplementation((async ({ where }: any) => {
    const ok =
      where.group.tenantId === TENANT_ID &&
      where.group.members.some.membership.userId === USER_ID &&
      where.group.members.some.membership.tenantId === TENANT_ID;
    return ok ? GROUP_GRANTS.map((permission) => ({ permission })) : [];
  }) as never);
});

describe("assertPermissionOrFail", () => {
  test("[B-46] a TENANT_ADMIN bypasses permission checks only in their own tenant, not at another club", async () => {
    const admin = makeSession({ id: "admin-1", role: "TENANT_ADMIN", tenantId: TENANT_ID });

    expect(await assertPermissionOrFail(admin, TENANT_ID, "bookings_admin_override" as never)).toBeNull();
    expect(await assertPermissionOrFail(admin, "bookings_admin_override" as never)).toBeNull();

    const res = await assertPermissionOrFail(admin, "partner-club", "bookings_admin_override" as never);
    expect(res?.status).toBe(403);
  });

  test("TENANT_ADMIN bypasses — always passes", async () => {
    const session = makeSession({ role: "TENANT_ADMIN", tenantId: TENANT_ID });
    const result = await assertPermissionOrFail(session, "bookings_view");
    expect(result).toBeNull();
    expect(prismaMock.groupMember.findFirst).not.toHaveBeenCalled();
  });

  test("TENANT_ADMIN bypasses even for permissions the user has no group for", async () => {
    const session = makeSession({ role: "TENANT_ADMIN", tenantId: TENANT_ID });
    const result = await assertPermissionOrFail(session, "federation_manage");
    expect(result).toBeNull();
  });

  test("PLATFORM_ADMIN impersonating as TENANT_ADMIN bypasses", async () => {
    const session = makeSession({
      id: "pa-1",
      role: "PLATFORM_ADMIN",
      tenantId: null,
      actingAs: {
        tenantId: TENANT_ID,
        role: "TENANT_ADMIN",
        impersonationId: "imp-1",
        startedAt: new Date().toISOString(),
      },
    });
    const result = await assertPermissionOrFail(session, "bookings_view");
    expect(result).toBeNull();
  });

  test("PLATFORM_ADMIN not impersonating returns PLATFORM_ADMIN_NO_CONTEXT", async () => {
    const session = makeSession({ id: "pa-2", role: "PLATFORM_ADMIN", tenantId: null });
    const result = await assertPermissionOrFail(session, "bookings_view");
    expect(result).not.toBeNull();
    const body = await result!.json();
    expect(result!.status).toBe(403);
    expect(body.error).toBe("PLATFORM_ADMIN_NO_CONTEXT");
  });

  test("looks up a group membership scoped to the user, the tenant and the permission", async () => {
    const session = makeSession({ id: USER_ID, role: "USER", tenantId: TENANT_ID });
    await assertPermissionOrFail(session, "bookings_view");
    expect(prismaMock.groupMember.findFirst).toHaveBeenCalledWith({
      where: {
        membership: { userId: USER_ID, tenantId: TENANT_ID },
        group: { tenantId: TENANT_ID, grants: { some: { permission: "bookings_view" } } },
      },
    });
  });

  test("USER with matching group+grant passes", async () => {
    const session = makeSession({ id: USER_ID, role: "USER", tenantId: TENANT_ID });
    const result = await assertPermissionOrFail(session, "bookings_view");
    expect(result).toBeNull();
  });

  test("USER without matching grant returns 403", async () => {
    const session = makeSession({ id: USER_ID, role: "USER", tenantId: TENANT_ID });
    const result = await assertPermissionOrFail(session, "charity_finalise_tar");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  test("USER in group but specific grant removed returns 403", async () => {
    const session = makeSession({ id: USER_ID, role: "USER", tenantId: TENANT_ID });
    // User has bookings_view and bookings_create, but NOT bookings_manage
    const result = await assertPermissionOrFail(session, "bookings_manage");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});

describe("hasPermission", () => {
  test("returns true when permission is granted", async () => {
    const session = makeSession({ id: USER_ID, role: "USER", tenantId: TENANT_ID });
    expect(await hasPermission(session, "bookings_view")).toBe(true);
  });

  test("returns false when permission is not granted", async () => {
    const session = makeSession({ id: USER_ID, role: "USER", tenantId: TENANT_ID });
    expect(await hasPermission(session, "charity_finalise_tar")).toBe(false);
  });
});

describe("getEffectivePermissions", () => {
  test("TENANT_ADMIN gets all permissions", async () => {
    const session = makeSession({ role: "TENANT_ADMIN", tenantId: TENANT_ID });
    const perms = await getEffectivePermissions(session);
    expect(perms).toEqual(ALL_PERMISSIONS);
  });

  test("USER gets union of group grants, queried distinct within the active tenant", async () => {
    const session = makeSession({ id: USER_ID, role: "USER", tenantId: TENANT_ID });
    const perms = await getEffectivePermissions(session);
    expect(perms).toContain("bookings_view");
    expect(perms).toContain("bookings_create");
    expect(perms).toHaveLength(2);
    expect(prismaMock.permissionGrant.findMany).toHaveBeenCalledWith({
      where: {
        group: {
          tenantId: TENANT_ID,
          members: { some: { membership: { userId: USER_ID, tenantId: TENANT_ID } } },
        },
      },
      select: { permission: true },
      distinct: ["permission"],
    });
  });

  test("USER with no groups gets empty array", async () => {
    const session = makeSession({ id: "no-group-user", role: "USER", tenantId: TENANT_ID });
    const perms = await getEffectivePermissions(session);
    expect(perms).toEqual([]);
  });

  test("PLATFORM_ADMIN not impersonating gets empty array", async () => {
    const session = makeSession({ id: "pa-3", role: "PLATFORM_ADMIN", tenantId: null });
    const perms = await getEffectivePermissions(session);
    expect(perms).toEqual([]);
    expect(prismaMock.permissionGrant.findMany).not.toHaveBeenCalled();
  });
});
