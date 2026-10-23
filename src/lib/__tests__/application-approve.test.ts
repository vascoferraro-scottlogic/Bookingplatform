jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/outbound", () => ({ sendEmail: jest.fn(), sendSocial: jest.fn() }));

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, routeParams } from "@/test-utils/http";
import { dateFromToday } from "@/test-utils/dates";
import { POST as APPROVE } from "@/app/api/admin/applications/[id]/approve/route";
import { POST as CREATE_TENANT } from "@/app/api/admin/tenants/route";

const APP_ID = "app-1";
const NEW_TENANT = "t-new";

const approve = async (body: Record<string, unknown> = {}) =>
  readJson(
    await APPROVE(jsonRequest("POST", `/api/admin/applications/${APP_ID}/approve`, body), routeParams({ id: APP_ID })),
  );

const createTenant = async (body: Record<string, unknown>) =>
  readJson(await CREATE_TENANT(jsonRequest("POST", "/api/admin/tenants", body)));

function givenApplication(overrides: Record<string, unknown> = {}) {
  prismaMock.tenantApplication.findUnique.mockResolvedValue({
    id: APP_ID,
    clubName: "Riverside Bowls",
    contactName: "Rita River",
    contactEmail: "rita@riverside.test",
    contactPhone: null,
    country: "GB",
    region: null,
    notes: null,
    status: "PENDING",
    vertical: "BOWLS",
    decisionNotes: null,
    reviewedAt: null,
    reviewedById: null,
    tenantId: null,
    createdAt: dateFromToday(-3),
    updatedAt: dateFromToday(-3),
    ...overrides,
  } as never);
}

/**
 * Every feature flag the provisioning wrote, keyed by flag → enabled. Accepts
 * featureFlag.create / createMany / upsert, and nested writes on tenant.create.
 */
function flagsWritten(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const add = (d: any) => {
    if (d?.key) out[d.key] = d.enabled ?? false;
  };
  const addAll = (x: any) => (Array.isArray(x) ? x.forEach(add) : add(x));
  for (const [a] of prismaMock.featureFlag.create.mock.calls as any[]) add(a.data);
  for (const [a] of prismaMock.featureFlag.createMany.mock.calls as any[]) addAll(a.data);
  for (const [a] of prismaMock.featureFlag.upsert.mock.calls as any[]) {
    const key = a.create?.key ?? a.where?.tenantId_key?.key;
    out[key] = a.create?.enabled ?? a.update?.enabled ?? false;
  }
  for (const [a] of prismaMock.tenant.create.mock.calls as any[]) {
    const nested = a.data?.featureFlags;
    if (nested?.create) addAll(nested.create);
    if (nested?.createMany) addAll(nested.createMany.data);
  }
  return out;
}

beforeEach(() => {
  signInAs({ id: "pa-1", role: "PLATFORM_ADMIN", tenantId: null });
  prismaMock.tenant.findUnique.mockResolvedValue(null);
  prismaMock.tenant.create.mockImplementation((async ({ data }: any) => ({
    id: NEW_TENANT,
    name: data.name,
    slug: data.slug,
    users: [{ id: "u-new", email: "admin@new.test", role: "TENANT_ADMIN" }],
    greens: [],
  })) as never);
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.user.create.mockImplementation((async ({ data }: any) => ({
    id: "u-new",
    email: data.email,
    name: data.name,
  })) as never);
  prismaMock.membership.create.mockResolvedValue({ id: "m-new" } as never);
  prismaMock.userInvitation.create.mockResolvedValue({
    id: "inv-1",
    token: "tok-1",
    expiresAt: dateFromToday(14),
  } as never);
  prismaMock.tenantApplication.update.mockResolvedValue({ id: APP_ID, status: "APPROVED" } as never);
  prismaMock.tenantApplication.updateMany.mockResolvedValue({ count: 1 } as never);
});

describe("POST /api/admin/applications/[id]/approve", () => {
  test("[B-81] FR-FLAG-004 – approving a BOWLS application applies the bowls preset (bookings + agent)", async () => {
    givenApplication({ vertical: "BOWLS" });

    const { status } = await approve();

    expect(status).toBe(200);
    expect(flagsWritten()).toEqual(expect.objectContaining({ bookings: true, agent: true }));
  });

  test("[B-81] FR-FLAG-004 – approving a CHARITY_ADMIN application applies the charity preset (funding + charity, no bookings)", async () => {
    givenApplication({ vertical: "CHARITY_ADMIN" });

    const { status } = await approve();

    expect(status).toBe(200);
    const flags = flagsWritten();
    expect(flags).toEqual(expect.objectContaining({ funding: true, charity: true }));
    expect(flags.bookings).not.toBe(true);
  });

  test.each(["REJECTED", "MORE_INFO_REQUESTED"])(
    "[B-82] FR-ONB-003 – approving a %s application → 409 and nothing is provisioned",
    async (appStatus) => {
      givenApplication({ status: appStatus });

      const { status } = await approve();

      expect(status).toBe(409);
      expect(prismaMock.tenant.create).not.toHaveBeenCalled();
      expect(prismaMock.userInvitation.create).not.toHaveBeenCalled();
    },
  );

  test("[B-82] FR-ONB-004 – provisioning (tenant, membership, invitation) runs in one prisma.$transaction", async () => {
    givenApplication();
    // Track which writes happen inside a transaction. Interactive form: calls
    // made while the callback runs. Array form: the call's promise is in the array.
    let inTx = false;
    const inside = new Set<string>();
    const arrays: unknown[] = [];
    const watch = (name: string, m: jest.Mock) => {
      const impl = m.getMockImplementation();
      m.mockImplementation((...args: unknown[]) => {
        if (inTx) inside.add(name);
        const r = impl ? impl(...args) : Promise.resolve(undefined);
        (r as any).__name = name;
        return r;
      });
    };
    watch("tenant.create", prismaMock.tenant.create as unknown as jest.Mock);
    watch("membership.create", prismaMock.membership.create as unknown as jest.Mock);
    watch("userInvitation.create", prismaMock.userInvitation.create as unknown as jest.Mock);
    prismaMock.$transaction.mockImplementation((async (arg: any) => {
      if (typeof arg === "function") {
        inTx = true;
        try {
          return await arg(prismaMock);
        } finally {
          inTx = false;
        }
      }
      arrays.push(...arg);
      for (const p of arg) if (p?.__name) inside.add(p.__name);
      return Promise.all(arg);
    }) as never);

    const { status } = await approve();

    expect(status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect([...inside].sort()).toEqual(["membership.create", "tenant.create", "userInvitation.create"]);
  });
});

describe("POST /api/admin/tenants (platform-admin create)", () => {
  const base = {
    name: "Hilltop Bowls",
    slug: "hilltop-bowls",
    adminEmail: "admin@hilltop.test",
    adminPassword: "test-only-Passw0rd!",
  };

  test("[B-81] FR-FLAG-004 – creating a tenant with no vertical applies the default (bowls) preset flags", async () => {
    const { status } = await createTenant(base);

    expect(status).toBe(201);
    expect(flagsWritten()).toEqual(expect.objectContaining({ bookings: true, agent: true }));
  });

  test("[B-81] FR-FLAG-004 – creating a CHARITY_ADMIN tenant applies the charity preset (funding + charity, no bookings)", async () => {
    const { status } = await createTenant({ ...base, vertical: "CHARITY_ADMIN" });

    expect(status).toBe(201);
    const flags = flagsWritten();
    expect(flags).toEqual(expect.objectContaining({ funding: true, charity: true }));
    expect(flags.bookings).not.toBe(true);
  });
});
