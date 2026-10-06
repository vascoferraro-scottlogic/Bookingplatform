import { prisma } from "@/lib/prisma";
import { resolveActiveContext, getActiveMembershipsForUser, pickPrimaryMembership } from "@/lib/memberships";

let userId: string;
let tenantAId: string;
let tenantBId: string;
const cleanup: { tenantIds: string[]; userIds: string[] } = { tenantIds: [], userIds: [] };

beforeAll(async () => {
  const stamp = Date.now();
  const tA = await prisma.tenant.create({ data: { name: "Tenant A", slug: `mb-a-${stamp}`, status: "ACTIVE", active: true } });
  const tB = await prisma.tenant.create({ data: { name: "Tenant B", slug: `mb-b-${stamp}`, status: "ACTIVE", active: true } });
  tenantAId = tA.id;
  tenantBId = tB.id;
  cleanup.tenantIds.push(tA.id, tB.id);

  const u = await prisma.user.create({
    data: {
      email: `mb-${stamp}@test.com`,
      passwordHash: "x",
      role: "USER",
      tenantId: tA.id,
    },
  });
  userId = u.id;
  cleanup.userIds.push(u.id);

  // Membership A first (lowest createdAt) → it's the primary
  await prisma.membership.create({
    data: { userId: u.id, tenantId: tA.id, role: "USER", kind: "MEMBER", status: "ACTIVE" },
  });
  // Then B as STAFF — multi-club user (e.g. greenkeeper)
  await new Promise((r) => setTimeout(r, 10)); // ensure ordering by createdAt
  await prisma.membership.create({
    data: { userId: u.id, tenantId: tB.id, role: "MAINTENANCE", kind: "CONTRACTOR", status: "ACTIVE" },
  });
});

afterAll(async () => {
  await prisma.membership.deleteMany({ where: { userId: { in: cleanup.userIds } } });
  await prisma.user.updateMany({ where: { id: { in: cleanup.userIds } }, data: { tenantId: null } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: cleanup.tenantIds } } });
  await prisma.$disconnect();
});

describe("memberships helpers", () => {
  test("getActiveMembershipsForUser returns both clubs", async () => {
    const list = await getActiveMembershipsForUser(userId);
    expect(list).toHaveLength(2);
    const ids = list.map((m) => m.tenantId).sort();
    expect(ids).toContain(tenantAId);
    expect(ids).toContain(tenantBId);
  });

  test("pickPrimaryMembership returns the lowest-createdAt active", async () => {
    const list = await getActiveMembershipsForUser(userId);
    const primary = pickPrimaryMembership(list);
    expect(primary?.tenantId).toBe(tenantAId);
  });

  test("resolveActiveContext honours preferredTenantId when active", async () => {
    const ctx = await resolveActiveContext(userId, tenantBId);
    expect(ctx.tenantId).toBe(tenantBId);
    expect(ctx.role).toBe("MAINTENANCE");
    expect(ctx.kind).toBe("CONTRACTOR");
  });

  test("resolveActiveContext falls back to primary when preferred is invalid", async () => {
    const ctx = await resolveActiveContext(userId, "nonexistent-tenant-id");
    expect(ctx.tenantId).toBe(tenantAId);
  });

  test("resolveActiveContext returns nulls for users with no memberships", async () => {
    const stamp = Date.now() + 999;
    const orphan = await prisma.user.create({
      data: { email: `orphan-${stamp}@test.com`, passwordHash: "x", role: "USER" },
    });
    cleanup.userIds.push(orphan.id);
    const ctx = await resolveActiveContext(orphan.id, null);
    expect(ctx.tenantId).toBeNull();
  });

  test("resolveActiveContext skips suspended memberships when picking preferred", async () => {
    // Suspend B; preferred B should fall through to primary A
    await prisma.membership.updateMany({
      where: { userId, tenantId: tenantBId },
      data: { status: "SUSPENDED" },
    });
    const ctx = await resolveActiveContext(userId, tenantBId);
    expect(ctx.tenantId).toBe(tenantAId);

    // Restore for any later tests
    await prisma.membership.updateMany({
      where: { userId, tenantId: tenantBId },
      data: { status: "ACTIVE" },
    });
  });
});
