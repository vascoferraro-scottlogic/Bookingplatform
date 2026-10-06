import { prisma } from "@/lib/prisma";
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

let tenantId: string;
let userId: string;
let membershipId: string;
let groupId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "Perm Test Club", slug: `perm-test-${Date.now()}` },
  });
  tenantId = tenant.id;

  const user = await prisma.user.create({
    data: {
      email: `perm-user-${Date.now()}@test.com`,
      name: "Perm User",
      passwordHash: "x",
      role: "USER",
      tenantId,
    },
  });
  userId = user.id;

  const membership = await prisma.membership.create({
    data: { userId, tenantId, role: "USER", status: "ACTIVE" },
  });
  membershipId = membership.id;

  // Create a custom group with a single permission
  const group = await prisma.permissionGroup.create({
    data: {
      tenantId,
      name: "Test Group",
      grants: { create: [{ permission: "bookings_view" }, { permission: "bookings_create" }] },
    },
  });
  groupId = group.id;

  // Add user to the group
  await prisma.groupMember.create({
    data: { groupId, membershipId },
  });
});

afterAll(async () => {
  // Cleanup in reverse FK order
  await prisma.groupMember.deleteMany({ where: { group: { tenantId } } });
  await prisma.permissionGrant.deleteMany({ where: { group: { tenantId } } });
  await prisma.permissionGroup.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});

describe("assertPermissionOrFail", () => {
  test("TENANT_ADMIN bypasses — always passes", async () => {
    const session = makeSession({ role: "TENANT_ADMIN", tenantId });
    const result = await assertPermissionOrFail(session, "bookings_view");
    expect(result).toBeNull();
  });

  test("TENANT_ADMIN bypasses even for permissions the user has no group for", async () => {
    const session = makeSession({ role: "TENANT_ADMIN", tenantId });
    const result = await assertPermissionOrFail(session, "federation_manage");
    expect(result).toBeNull();
  });

  test("PLATFORM_ADMIN impersonating as TENANT_ADMIN bypasses", async () => {
    const session = makeSession({
      id: "pa-1",
      role: "PLATFORM_ADMIN",
      tenantId: null,
      actingAs: {
        tenantId,
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

  test("USER with matching group+grant passes", async () => {
    const session = makeSession({ id: userId, role: "USER", tenantId });
    const result = await assertPermissionOrFail(session, "bookings_view");
    expect(result).toBeNull();
  });

  test("USER without matching grant returns 403", async () => {
    const session = makeSession({ id: userId, role: "USER", tenantId });
    const result = await assertPermissionOrFail(session, "charity_finalise_tar");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  test("USER in group but specific grant removed returns 403", async () => {
    const session = makeSession({ id: userId, role: "USER", tenantId });
    // User has bookings_view and bookings_create, but NOT bookings_manage
    const result = await assertPermissionOrFail(session, "bookings_manage");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});

describe("hasPermission", () => {
  test("returns true when permission is granted", async () => {
    const session = makeSession({ id: userId, role: "USER", tenantId });
    expect(await hasPermission(session, "bookings_view")).toBe(true);
  });

  test("returns false when permission is not granted", async () => {
    const session = makeSession({ id: userId, role: "USER", tenantId });
    expect(await hasPermission(session, "charity_finalise_tar")).toBe(false);
  });
});

describe("getEffectivePermissions", () => {
  test("TENANT_ADMIN gets all permissions", async () => {
    const session = makeSession({ role: "TENANT_ADMIN", tenantId });
    const perms = await getEffectivePermissions(session);
    expect(perms).toEqual(ALL_PERMISSIONS);
  });

  test("USER gets union of group grants", async () => {
    const session = makeSession({ id: userId, role: "USER", tenantId });
    const perms = await getEffectivePermissions(session);
    expect(perms).toContain("bookings_view");
    expect(perms).toContain("bookings_create");
    expect(perms).toHaveLength(2);
  });

  test("USER with no groups gets empty array", async () => {
    // Create a user with no group membership
    const noGroupUser = await prisma.user.create({
      data: { email: `no-group-${Date.now()}@test.com`, passwordHash: "x", role: "USER", tenantId },
    });
    await prisma.membership.create({
      data: { userId: noGroupUser.id, tenantId, role: "USER", status: "ACTIVE" },
    });

    const session = makeSession({ id: noGroupUser.id, role: "USER", tenantId });
    const perms = await getEffectivePermissions(session);
    expect(perms).toEqual([]);

    // Cleanup
    await prisma.membership.deleteMany({ where: { userId: noGroupUser.id } });
    await prisma.user.delete({ where: { id: noGroupUser.id } });
  });

  test("PLATFORM_ADMIN not impersonating gets empty array", async () => {
    const session = makeSession({ id: "pa-3", role: "PLATFORM_ADMIN", tenantId: null });
    const perms = await getEffectivePermissions(session);
    expect(perms).toEqual([]);
  });
});
