/**
 * GET / PATCH /api/admin/users/[id] (B-04, B-05).
 */
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, request, routeParams } from "@/test-utils/http";
import { GET, PATCH } from "@/app/api/admin/users/[id]/route";

const TENANT = "tenant-1";
const OTHER_TENANT = "tenant-2";
const TARGET = "user-9";

const TARGET_USER = {
  id: TARGET,
  email: "member@example.test",
  name: "Member",
  role: "USER",
  suspended: false,
  tenantId: TENANT,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  passwordHash: "$2a$12$abcdefghijklmnopqrstuuSECRETHASHVALUE0123456789abcdefg",
  bookings: [],
  _count: { bookings: 0, submittedTasks: 0 },
};

const MEMBERSHIPS = [
  { id: "m-1", userId: TARGET, tenantId: TENANT, role: "USER", kind: "MEMBER", status: "ACTIVE", createdAt: new Date("2026-01-01") },
  { id: "m-2", userId: TARGET, tenantId: OTHER_TENANT, role: "USER", kind: "MEMBER", status: "ACTIVE", createdAt: new Date("2026-02-01") },
];

/** Returns only the selected top-level fields, like Prisma does. */
function pick(row: any, select?: Record<string, unknown>) {
  if (!select) return row;
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));
}

const asTenantAdmin = () => signInAs({ id: "admin-1", role: "TENANT_ADMIN", tenantId: TENANT });
const asImpersonatingPlatformAdmin = () =>
  signInAs({
    id: "platform-1",
    role: "PLATFORM_ADMIN",
    tenantId: null,
    actingAs: { tenantId: TENANT, role: "TENANT_ADMIN", impersonationId: "imp-1", startedAt: new Date().toISOString() },
  });

beforeEach(() => {
  prismaMock.user.findUnique.mockImplementation((async ({ where, select }: any) =>
    where.id === TARGET ? pick({ ...TARGET_USER, memberships: MEMBERSHIPS }, select) : null) as never);
  prismaMock.user.findFirst.mockImplementation((async ({ where, select }: any) =>
    where.id === TARGET ? pick({ ...TARGET_USER, memberships: MEMBERSHIPS }, select) : null) as never);
  prismaMock.user.update.mockImplementation((async ({ data, select }: any) => pick({ ...TARGET_USER, ...data }, select)) as never);

  const findMembership = async ({ where }: any) => {
    const key = where?.userId_tenantId ?? where;
    return MEMBERSHIPS.find((m) => m.userId === key.userId && m.tenantId === key.tenantId) ?? null;
  };
  prismaMock.membership.findUnique.mockImplementation(findMembership as never);
  prismaMock.membership.findFirst.mockImplementation(findMembership as never);
  prismaMock.membership.findMany.mockResolvedValue(MEMBERSHIPS as never);
  prismaMock.membership.update.mockImplementation((async ({ where, data }: any) => ({ ...(MEMBERSHIPS.find((m) => m.id === where.id) ?? MEMBERSHIPS[0]), ...data })) as never);
  prismaMock.membership.updateMany.mockResolvedValue({ count: 1 } as never);
  prismaMock.membership.upsert.mockImplementation((async ({ update }: any) => ({ ...MEMBERSHIPS[0], ...update })) as never);
});

const patch = (body: unknown) => PATCH(jsonRequest("PATCH", `/api/admin/users/${TARGET}`, body), routeParams({ id: TARGET }));

/** Every membership write as { where, data }. */
function membershipWrites() {
  return [
    ...prismaMock.membership.update.mock.calls.map(([a]: any) => ({ where: a.where, data: a.data })),
    ...prismaMock.membership.updateMany.mock.calls.map(([a]: any) => ({ where: a.where, data: a.data })),
    ...prismaMock.membership.upsert.mock.calls.map(([a]: any) => ({ where: a.where, data: a.update })),
  ];
}

/** True when a membership write's `where` targets (TARGET, tenantId). */
function targetsMembership(where: any, tenantId: string) {
  const m = MEMBERSHIPS.find((x) => x.tenantId === tenantId)!;
  if (!where) return false;
  if (where.id === m.id) return true;
  const key = where.userId_tenantId ?? where;
  return key.userId === TARGET && key.tenantId === tenantId;
}

function userWrites() {
  return prismaMock.user.update.mock.calls.map(([a]: any) => a.data ?? {});
}

describe("GET /api/admin/users/[id]", () => {
  test("[B-04] NFR-05 – ?include=full never returns passwordHash", async () => {
    asTenantAdmin();

    const { status, body } = await readJson(
      await GET(request(`/api/admin/users/${TARGET}?include=full`), routeParams({ id: TARGET })),
    );

    expect(status).toBe(200);
    expect(body).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(body)).not.toContain(TARGET_USER.passwordHash);
  });
});

describe("PATCH /api/admin/users/[id] — roles", () => {
  test("[B-05] FR-SEC-006 – a tenant admin setting role PLATFORM_ADMIN gets 400 and nothing is written", async () => {
    asTenantAdmin();

    const res = await patch({ role: "PLATFORM_ADMIN", suspended: false });

    expect(res.status).toBe(400);
    expect(userWrites()).toHaveLength(0);
    expect(membershipWrites()).toHaveLength(0);
  });

  test("[B-05] FR-SEC-006 – an impersonating platform admin cannot grant PLATFORM_ADMIN through the tenant endpoint (400)", async () => {
    asImpersonatingPlatformAdmin();

    const res = await patch({ role: "PLATFORM_ADMIN" });

    expect(res.status).toBe(400);
    expect(userWrites().some((d) => d.role === "PLATFORM_ADMIN")).toBe(false);
    expect(membershipWrites().some((w) => w.data?.role === "PLATFORM_ADMIN")).toBe(false);
  });

  test("[B-05] FR-SEC-006 – a role change updates Membership.role for that tenant", async () => {
    asImpersonatingPlatformAdmin();

    const res = await patch({ role: "MAINTENANCE" });

    expect(res.status).toBe(200);
    const writes = membershipWrites().filter((w) => w.data?.role === "MAINTENANCE");
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((w) => targetsMembership(w.where, TENANT))).toBe(true);
  });
});

describe("PATCH /api/admin/users/[id] — suspension", () => {
  test("[B-05] FR-SET-002 – suspending a member affects only that tenant's membership", async () => {
    asTenantAdmin();

    const res = await patch({ suspended: true });

    expect(res.status).toBe(200);
    // Not the global User.suspended flag (that would lock them out of tenant-2 too) …
    expect(userWrites().some((d) => "suspended" in d)).toBe(false);
    // … but this tenant's membership.
    const writes = membershipWrites().filter((w) => w.data?.status === "SUSPENDED");
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((w) => targetsMembership(w.where, TENANT))).toBe(true);
    expect(membershipWrites().some((w) => targetsMembership(w.where, OTHER_TENANT))).toBe(false);
  });
});
