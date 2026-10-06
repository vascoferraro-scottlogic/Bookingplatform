import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
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
let groupId1: string;
let groupId2: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Perm Sig Test", slug: `perm-sig-${Date.now()}` } });
  tenantId = tenant.id;

  const user = await prisma.user.create({ data: { email: `perm-sig-${Date.now()}@test.com`, name: "Perm Sig", passwordHash: "x", role: "USER", tenantId } });
  userId = user.id;

  const membership = await prisma.membership.create({ data: { userId, tenantId, role: "USER", status: "ACTIVE" } });
  membershipId = membership.id;

  const g1 = await prisma.permissionGroup.create({ data: { tenantId, name: "G1", grants: { create: [{ permission: "bookings_view" }] } } });
  groupId1 = g1.id;
  const g2 = await prisma.permissionGroup.create({ data: { tenantId, name: "G2", grants: { create: [{ permission: "bookings_create" }] } } });
  groupId2 = g2.id;

  await prisma.groupMember.createMany({ data: [{ groupId: groupId1, membershipId }, { groupId: groupId2, membershipId }] });
});

afterAll(async () => {
  await prisma.groupMember.deleteMany({ where: { membership: { tenantId } } });
  await prisma.permissionGrant.deleteMany({ where: { group: { tenantId } } });
  await prisma.permissionGroup.deleteMany({ where: { tenantId } });
  await prisma.membership.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

test("hasPermission supports both signatures", async () => {
  const session = makeSession({ id: userId, role: "USER", tenantId });
  expect(await hasPermission(session, "bookings_view")).toBe(true);
  expect(await hasPermission(session, tenantId, "bookings_view")).toBe(true);
  // Also assert second group's permission
  expect(await hasPermission(session, "bookings_create")).toBe(true);
});
