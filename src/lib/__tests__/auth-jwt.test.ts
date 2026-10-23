/**
 * The real NextAuth jwt / session callbacks from src/lib/auth.ts, called
 * directly (no next-auth runtime). Covers impersonation-claim validation
 * (B-03), role refresh (B-05) and suspended-tenant context selection (B-17).
 */
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);

import { authOptions } from "@/lib/auth";
import { prismaMock } from "@/test-utils/prisma-mock";
import { hoursFromNow } from "@/test-utils/dates";

const jwt = authOptions.callbacks!.jwt! as (args: any) => Promise<any>;
const sessionCb = authOptions.callbacks!.session! as (args: any) => Promise<any>;

const PLATFORM_ADMIN = "platform-1";
const ACTIVE_TENANT = { id: "tenant-1", name: "Lakeview", slug: "lakeview", brandColor: "#0a0", status: "ACTIVE", active: true, locality: null, locale: "en" };
const OTHER_ACTIVE_TENANT = { id: "tenant-3", name: "Riverside", slug: "riverside", brandColor: "#00a", status: "ACTIVE", active: true, locality: null, locale: "en" };
const SUSPENDED_TENANT = { id: "tenant-2", name: "Suspended", slug: "suspended", brandColor: "#a00", status: "SUSPENDED", active: false, locality: null, locale: "en" };
const TENANTS = [ACTIVE_TENANT, OTHER_ACTIVE_TENANT, SUSPENDED_TENANT];

// ─── A tiny where-matcher so mocks behave like the DB for simple filters ────

function matchValue(actual: any, cond: any): boolean {
  if (cond === null || typeof cond !== "object" || cond instanceof Date) {
    if (cond instanceof Date) return actual instanceof Date && actual.getTime() === cond.getTime();
    return actual === cond || (cond === null && actual === undefined);
  }
  const ops = ["equals", "in", "notIn", "not", "gt", "gte", "lt", "lte"];
  if (Object.keys(cond).some((k) => ops.includes(k))) {
    const t = (v: any) => (v instanceof Date ? v.getTime() : v);
    if ("equals" in cond && !matchValue(actual, cond.equals)) return false;
    if ("in" in cond && !cond.in.includes(actual)) return false;
    if ("notIn" in cond && cond.notIn.includes(actual)) return false;
    if ("not" in cond && matchValue(actual, cond.not)) return false;
    if ("gt" in cond && !(t(actual) > t(cond.gt))) return false;
    if ("gte" in cond && !(t(actual) >= t(cond.gte))) return false;
    if ("lt" in cond && !(t(actual) < t(cond.lt))) return false;
    if ("lte" in cond && !(t(actual) <= t(cond.lte))) return false;
    return true;
  }
  return matchesWhere(actual ?? {}, cond);
}

function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === "AND") return [].concat(v as any).every((w) => matchesWhere(row, w));
    if (k === "OR") return (v as any[]).some((w) => matchesWhere(row, w));
    if (k === "NOT") return ![].concat(v as any).some((w) => matchesWhere(row, w));
    return matchValue(row[k], v);
  });
}

/** Backs prisma.impersonation.* with the given rows. */
function givenImpersonations(rows: any[]) {
  const withTenant = rows.map((r) => ({ ...r, tenant: TENANTS.find((t) => t.id === r.tenantId) }));
  const find = async ({ where }: any) => withTenant.find((r) => matchesWhere(r, where)) ?? null;
  prismaMock.impersonation.findUnique.mockImplementation(find as never);
  prismaMock.impersonation.findFirst.mockImplementation(find as never);
  prismaMock.impersonation.findMany.mockImplementation((async ({ where }: any = {}) => withTenant.filter((r) => matchesWhere(r, where))) as never);
  prismaMock.impersonation.count.mockImplementation((async ({ where }: any = {}) => withTenant.filter((r) => matchesWhere(r, where)).length) as never);
  prismaMock.impersonation.updateMany.mockResolvedValue({ count: 0 } as never);
}

/** Backs prisma.membership.* with the given rows (tenant joined). */
function givenMemberships(rows: any[]) {
  const full = rows.map((r, i) => ({
    id: `m-${i}`,
    kind: "MEMBER",
    status: "ACTIVE",
    createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
    ...r,
    tenant: TENANTS.find((t) => t.id === r.tenantId),
  }));
  prismaMock.membership.findMany.mockImplementation((async ({ where }: any = {}) => full.filter((r) => matchesWhere(r, where))) as never);
  const one = async ({ where }: any) => {
    if (where?.userId_tenantId) return full.find((r) => r.userId === where.userId_tenantId.userId && r.tenantId === where.userId_tenantId.tenantId) ?? null;
    return full.find((r) => matchesWhere(r, where)) ?? null;
  };
  prismaMock.membership.findUnique.mockImplementation(one as never);
  prismaMock.membership.findFirst.mockImplementation(one as never);
}

beforeEach(() => {
  prismaMock.tenant.findUnique.mockImplementation((async ({ where }: any) => TENANTS.find((t) => t.id === where.id) ?? null) as never);
  prismaMock.tenant.findFirst.mockImplementation((async ({ where }: any) => TENANTS.find((t) => matchesWhere(t, where)) ?? null) as never);
  prismaMock.user.findUnique.mockImplementation((async ({ where }: any) =>
    where.id === PLATFORM_ADMIN
      ? { id: PLATFORM_ADMIN, role: "PLATFORM_ADMIN", tenantId: null, suspended: false }
      : { id: where.id, role: "USER", tenantId: null, suspended: false }) as never);
  givenMemberships([]);
  givenImpersonations([]);
});

function platformAdminToken(actingAs: any = null) {
  return { sub: PLATFORM_ADMIN, role: "PLATFORM_ADMIN", tenantId: null, activeTenantId: null, locale: "en", actingAs };
}

function claimFor(row: { id: string; tenantId: string; assumedRole: string; startedAt: Date }) {
  return {
    tenantId: row.tenantId,
    tenantName: "Lakeview",
    tenantSlug: "lakeview",
    role: row.assumedRole,
    impersonationId: row.id,
    startedAt: row.startedAt.toISOString(),
  };
}

const openRow = (overrides: Record<string, unknown> = {}) => ({
  id: "imp-1",
  platformUserId: PLATFORM_ADMIN,
  tenantId: ACTIVE_TENANT.id,
  assumedRole: "TENANT_ADMIN",
  startedAt: hoursFromNow(-1),
  endedAt: null,
  reason: null,
  ...overrides,
});

describe("[B-03] jwt callback — actingAs (impersonation) claim", () => {
  test("[B-03] FR-SEC-004 – an update with an actingAs claim but no open Impersonation row is not applied", async () => {
    givenImpersonations([]); // nothing in the DB
    const forged = claimFor({ id: "imp-forged", tenantId: ACTIVE_TENANT.id, assumedRole: "TENANT_ADMIN", startedAt: new Date() });

    const token = await jwt({ token: platformAdminToken(), trigger: "update", session: { actingAs: forged } });

    expect(token.actingAs ?? null).toBeNull();
  });

  test("[B-03] FR-SEC-004 – an actingAs claim matching this admin's open Impersonation row is accepted", async () => {
    const row = openRow();
    givenImpersonations([row]);

    const token = await jwt({ token: platformAdminToken(), trigger: "update", session: { actingAs: claimFor(row) } });

    expect(token.actingAs).toMatchObject({ tenantId: ACTIVE_TENANT.id, role: "TENANT_ADMIN", impersonationId: "imp-1" });
  });

  test("[B-03] FR-SEC-004 – an actingAs claim naming another admin's Impersonation row is not applied", async () => {
    const row = openRow({ platformUserId: "someone-else" });
    givenImpersonations([row]);

    const token = await jwt({ token: platformAdminToken(), trigger: "update", session: { actingAs: claimFor(row) } });

    expect(token.actingAs ?? null).toBeNull();
  });

  test("[B-03] FR-SEC-006 – once the impersonation has ended (endedAt set) the claim is dropped on the next jwt call", async () => {
    const row = openRow();
    const token = platformAdminToken(claimFor(row));
    givenImpersonations([{ ...row, endedAt: new Date() }]);

    const next = await jwt({ token });
    const session = await sessionCb({ session: { user: {}, expires: "" }, token: next });

    expect(next.actingAs ?? null).toBeNull();
    expect(session.user.actingAs ?? null).toBeNull();
  });

  test("[B-03] D-15 – an impersonation started more than 8 hours ago is dropped on the next jwt call", async () => {
    const row = openRow({ startedAt: hoursFromNow(-9) });
    givenImpersonations([row]); // still open in the DB, but past the 8h limit

    const next = await jwt({ token: platformAdminToken(claimFor(row)) });

    expect(next.actingAs ?? null).toBeNull();
  });
});

describe("[B-05] jwt callback — role refresh", () => {
  test("[B-05] FR-SEC-006 – a Membership.role change in the DB is picked up on the next jwt call", async () => {
    // Token minted when the user was a plain USER of tenant-1 …
    const token = { sub: "user-1", role: "USER", tenantId: ACTIVE_TENANT.id, activeTenantId: ACTIVE_TENANT.id, locale: "en", actingAs: null };
    // … and an admin has since promoted them.
    givenMemberships([{ userId: "user-1", tenantId: ACTIVE_TENANT.id, role: "TENANT_ADMIN" }]);

    const next = await jwt({ token });

    expect(next.role).toBe("TENANT_ADMIN");
    expect(next.tenantId).toBe(ACTIVE_TENANT.id);
  });
});

describe("[B-17] jwt callback — suspended tenants", () => {
  test("[B-17] D-08 – at sign-in, a membership in a SUSPENDED tenant does not become the active context", async () => {
    // The suspended membership is the oldest, so it would be the "primary".
    givenMemberships([
      { userId: "user-1", tenantId: SUSPENDED_TENANT.id, role: "TENANT_ADMIN" },
      { userId: "user-1", tenantId: OTHER_ACTIVE_TENANT.id, role: "USER" },
    ]);

    const token = await jwt({ token: { sub: "user-1" }, user: { id: "user-1", role: "USER", tenantId: null } });

    expect(token.tenantId).not.toBe(SUSPENDED_TENANT.id);
    expect(token.activeTenantId).not.toBe(SUSPENDED_TENANT.id);
    expect(token.activeTenantId).toBe(OTHER_ACTIVE_TENANT.id);
  });

  test("[B-17] D-08 – the tenant switcher cannot switch to a membership in a SUSPENDED tenant", async () => {
    givenMemberships([
      { userId: "user-1", tenantId: OTHER_ACTIVE_TENANT.id, role: "USER" },
      { userId: "user-1", tenantId: SUSPENDED_TENANT.id, role: "TENANT_ADMIN" },
    ]);
    const token = { sub: "user-1", role: "USER", tenantId: OTHER_ACTIVE_TENANT.id, activeTenantId: OTHER_ACTIVE_TENANT.id, locale: "en", actingAs: null };

    const next = await jwt({ token, trigger: "update", session: { activeTenantId: SUSPENDED_TENANT.id } });

    expect(next.activeTenantId).not.toBe(SUSPENDED_TENANT.id);
    expect(next.tenantId).not.toBe(SUSPENDED_TENANT.id);
    expect(next.role).not.toBe("TENANT_ADMIN");
  });
});
