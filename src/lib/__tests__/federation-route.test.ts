jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, request, routeParams } from "@/test-utils/http";
import { hoursFromNow } from "@/test-utils/dates";

import { GET, POST } from "@/app/api/federations/route";
import { GET as GET_ONE } from "@/app/api/federations/[id]/route";
import { POST as INVITE } from "@/app/api/federations/[id]/invite/route";
import { GET as GET_INVITE, POST as ACCEPT } from "@/app/api/federations/invite/[token]/route";
import { POST as DECLINE } from "@/app/api/federations/invite/[token]/decline/route";
import { POST as LEAVE } from "@/app/api/federations/[id]/leave/route";
import { GET as ADMIN_LIST } from "@/app/api/admin/federations/route";
import { PATCH as ADMIN_PATCH } from "@/app/api/admin/federations/[id]/route";

const T1 = "club-1";
const T2 = "club-2";
const SLUG2 = "fed-club-2";
const FED = "fed-alpha";
const TOKEN = "invite-token";
const ADMIN1 = { id: "admin-1", role: "TENANT_ADMIN" as const, tenantId: T1 };
const ADMIN2 = { id: "admin-2", role: "TENANT_ADMIN" as const, tenantId: T2 };
const USER1 = { id: "user-1", role: "USER" as const, tenantId: T1 };
const PLATFORM_ADMIN = { id: "pa-1", role: "PLATFORM_ADMIN" as const, tenantId: null };

const idParams = (id: string) => routeParams({ id });
const tokenParams = (token: string) => routeParams({ token });
const post = (body?: unknown) => jsonRequest("POST", "/api/federations", body);

const federationRow = { id: FED, name: "Test Fed Alpha", status: "ACTIVE", maxClubs: 10 };

/** T1 is an active member of FED; T2 is not. */
function t1IsOnlyMember() {
  prismaMock.federationMembership.findFirst.mockImplementation((async (args: any) =>
    args.where.federationId === FED && args.where.tenantId === T1 && args.where.leftAt === null
      ? { id: "fm-1", federationId: FED, tenantId: T1 }
      : null) as never);
}

/** A pending invite from T1 to T2 that expires in two weeks. */
function pendingInvite(overrides: Record<string, unknown> = {}) {
  prismaMock.federationInvite.findUnique.mockResolvedValue({
    id: "inv-1",
    token: TOKEN,
    federationId: FED,
    inviterTenantId: T1,
    inviteeTenantId: T2,
    status: "PENDING",
    expiresAt: hoursFromNow(14 * 24),
    federation: federationRow,
    ...overrides,
  } as never);
}

beforeEach(() => {
  // Federation feature is on for every club unless a test turns it off.
  prismaMock.featureFlag.findUnique.mockResolvedValue({ enabled: true } as never);
});

// ── Create federation ──────────────────────────────────────

describe("POST /api/federations — create", () => {
  beforeEach(() => {
    prismaMock.federation.findUnique.mockResolvedValue(null);
    prismaMock.federationMembership.count.mockResolvedValue(0);
    prismaMock.federation.create.mockImplementation((async ({ data }: any) => ({
      id: FED,
      name: data.name,
      description: data.description,
      createdByTenantId: data.createdByTenantId,
      _count: { memberships: 1 },
    })) as never);
  });

  test("TENANT_ADMIN can create a federation", async () => {
    signInAs(ADMIN1);

    const { status, body } = await readJson(await POST(post({ name: "Test Fed Alpha", description: "For testing" })));

    expect(status).toBe(201);
    expect(body.name).toBe("Test Fed Alpha");
    // The creating club becomes the first member.
    expect(prismaMock.federation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: "Test Fed Alpha",
          description: "For testing",
          createdByTenantId: T1,
          memberships: { create: { tenantId: T1, billingMode: "HOST_CLUB_RATE" } },
        },
      }),
    );
  });

  test("USER gets 403", async () => {
    signInAs(USER1);

    const { status } = await readJson(await POST(post({ name: "Test Fed Nope" })));

    expect(status).toBe(403);
    expect(prismaMock.federation.create).not.toHaveBeenCalled();
  });

  test("duplicate name returns 409", async () => {
    signInAs(ADMIN1);
    prismaMock.federation.findUnique.mockResolvedValue(federationRow as never);

    const { status } = await readJson(await POST(post({ name: "Test Fed Alpha" })));

    expect(status).toBe(409);
    expect(prismaMock.federation.findUnique).toHaveBeenCalledWith({ where: { name: "Test Fed Alpha" } });
    expect(prismaMock.federation.create).not.toHaveBeenCalled();
  });

  test("federation feature disabled returns 403", async () => {
    signInAs(ADMIN1);
    prismaMock.featureFlag.findUnique.mockResolvedValue({ enabled: false } as never);

    const { status } = await readJson(await POST(post({ name: "Test Fed Blocked" })));

    expect(status).toBe(403);
    expect(prismaMock.featureFlag.findUnique).toHaveBeenCalledWith({
      where: { tenantId_key: { tenantId: T1, key: "federation" } },
    });
    expect(prismaMock.federation.create).not.toHaveBeenCalled();
  });
});

// ── List federations ──────────────────────────────────────

describe("GET /api/federations — list", () => {
  test("returns club's federations", async () => {
    signInAs(ADMIN1);
    prismaMock.federationMembership.findMany.mockResolvedValue([
      { billingMode: "HOST_CLUB_RATE", federation: { ...federationRow, _count: { memberships: 1 } } },
    ] as never);

    const { status, body } = await readJson(await GET());

    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual(expect.objectContaining({ name: "Test Fed Alpha", billingMode: "HOST_CLUB_RATE", memberCount: 1 }));
    expect(prismaMock.federationMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: T1, leftAt: null } }),
    );
  });

  test("club not in federation gets empty list", async () => {
    signInAs(ADMIN2);
    prismaMock.federationMembership.findMany.mockResolvedValue([] as never);

    const { status, body } = await readJson(await GET());

    expect(status).toBe(200);
    expect(body).toEqual([]);
    expect(prismaMock.federationMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: T2, leftAt: null } }),
    );
  });
});

// ── Federation detail ──────────────────────────────────────

describe("GET /api/federations/[id] — detail", () => {
  test("member sees federation detail with active members only", async () => {
    signInAs(ADMIN1);
    t1IsOnlyMember();
    prismaMock.federation.findUnique.mockResolvedValue({
      ...federationRow,
      memberships: [{ tenantId: T1 }],
      invites: [],
    } as never);

    const { status, body } = await readJson(await GET_ONE(request("/"), idParams(FED)));

    expect(status).toBe(200);
    expect(body.name).toBe("Test Fed Alpha");
    expect(body.memberships).toHaveLength(1);
    expect(prismaMock.federation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: FED },
        include: expect.objectContaining({ memberships: expect.objectContaining({ where: { leftAt: null } }) }),
      }),
    );
  });

  test("non-member gets 404", async () => {
    signInAs(ADMIN2);
    t1IsOnlyMember();

    const { status } = await readJson(await GET_ONE(request("/"), idParams(FED)));

    expect(status).toBe(404);
    expect(prismaMock.federationMembership.findFirst).toHaveBeenCalledWith({
      where: { federationId: FED, tenantId: T2, leftAt: null },
    });
    expect(prismaMock.federation.findUnique).not.toHaveBeenCalled();
  });
});

// ── Invite + accept lifecycle ──────────────────────────────

describe("Federation invite lifecycle", () => {
  describe("POST /api/federations/[id]/invite", () => {
    beforeEach(() => {
      t1IsOnlyMember();
      prismaMock.federation.findUnique.mockResolvedValue(federationRow as never);
      prismaMock.federationInvite.count.mockResolvedValue(0);
      prismaMock.tenant.findUnique.mockImplementation((async (args: any) =>
        args.where.slug === SLUG2 ? { id: T2, slug: SLUG2, name: "Fed Club 2" } : null) as never);
      prismaMock.federationInvite.findFirst.mockResolvedValue(null);
      prismaMock.federationMembership.count.mockResolvedValue(1);
      prismaMock.federationInvite.create.mockImplementation((async ({ data }: any) => ({
        id: "inv-1",
        token: TOKEN,
        ...data,
        inviteeTenant: { id: T2, name: "Fed Club 2", slug: SLUG2, locality: null },
      })) as never);
    });

    test("member can invite another club", async () => {
      signInAs(ADMIN1);

      const { status, body } = await readJson(await INVITE(post({ tenantSlug: SLUG2 }), idParams(FED)));

      expect(status).toBe(201);
      expect(body.inviteeTenant.slug).toBe(SLUG2);
      expect(body.token).toBe(TOKEN);
      expect(prismaMock.federationInvite.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ federationId: FED, inviterTenantId: T1, inviteeTenantId: T2 }),
        }),
      );
    });

    test("cannot invite same club twice", async () => {
      signInAs(ADMIN1);
      prismaMock.federationInvite.findFirst.mockResolvedValue({ id: "inv-1", status: "PENDING" } as never);

      const { status } = await readJson(await INVITE(post({ tenantSlug: SLUG2 }), idParams(FED)));

      expect(status).toBe(409);
      expect(prismaMock.federationInvite.findFirst).toHaveBeenCalledWith({
        where: { federationId: FED, inviteeTenantId: T2, status: "PENDING" },
      });
      expect(prismaMock.federationInvite.create).not.toHaveBeenCalled();
    });
  });

  test("invited club can fetch invite", async () => {
    signInAs(ADMIN2);
    pendingInvite();

    const { status, body } = await readJson(await GET_INVITE(request("/"), tokenParams(TOKEN)));

    expect(status).toBe(200);
    expect(body.federation.name).toBe("Test Fed Alpha");
    expect(prismaMock.federationInvite.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { token: TOKEN } }));
  });

  test("invited club can accept", async () => {
    signInAs(ADMIN2);
    pendingInvite();
    prismaMock.federationMembership.count.mockResolvedValue(1);

    const { status, body } = await readJson(await ACCEPT(request("/", { method: "POST" }), tokenParams(TOKEN)));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    // Accepting adds T2 as a member and marks the invite accepted.
    expect(prismaMock.federationMembership.create).toHaveBeenCalledWith({
      data: { federationId: FED, tenantId: T2, billingMode: "HOST_CLUB_RATE" },
    });
    expect(prismaMock.federationInvite.update).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { status: "ACCEPTED" },
    });
  });

  test("accepting again returns 400", async () => {
    signInAs(ADMIN2);
    pendingInvite({ status: "ACCEPTED" });

    const { status } = await readJson(await ACCEPT(request("/", { method: "POST" }), tokenParams(TOKEN)));

    expect(status).toBe(400);
    expect(prismaMock.federationMembership.create).not.toHaveBeenCalled();
  });
});

// ── Decline ──────────────────────────────────────────────

describe("POST /api/federations/invite/[token]/decline", () => {
  test("cannot decline an already-accepted invite", async () => {
    signInAs(ADMIN2);
    pendingInvite({ status: "ACCEPTED" });

    const { status } = await readJson(await DECLINE(request("/", { method: "POST" }), tokenParams(TOKEN)));

    expect(status).toBe(400);
    expect(prismaMock.federationInvite.update).not.toHaveBeenCalled();
  });
});

// ── Leave ──────────────────────────────────────────────

describe("POST /api/federations/[id]/leave", () => {
  test("member can leave a federation (soft leave: sets leftAt)", async () => {
    signInAs(ADMIN1);
    t1IsOnlyMember();

    const { status } = await readJson(await LEAVE(request("/", { method: "POST" }), idParams(FED)));

    expect(status).toBe(200);
    expect(prismaMock.federationMembership.update).toHaveBeenCalledWith({
      where: { id: "fm-1" },
      data: { leftAt: expect.any(Date) },
    });
  });

  test("leaving when not an active member returns 404", async () => {
    signInAs(ADMIN2);
    t1IsOnlyMember();

    const { status } = await readJson(await LEAVE(request("/", { method: "POST" }), idParams(FED)));

    expect(status).toBe(404);
    expect(prismaMock.federationMembership.findFirst).toHaveBeenCalledWith({
      where: { federationId: FED, tenantId: T2, leftAt: null },
    });
    expect(prismaMock.federationMembership.update).not.toHaveBeenCalled();
  });
});

// ── Platform admin ──────────────────────────────────────

describe("Platform admin federation routes", () => {
  test("GET /api/admin/federations lists all", async () => {
    signInAs(PLATFORM_ADMIN);
    prismaMock.federation.findMany.mockResolvedValue([{ ...federationRow, _count: { memberships: 2 } }] as never);

    const { status, body } = await readJson(await ADMIN_LIST());

    expect(status).toBe(200);
    expect(body).toEqual([expect.objectContaining({ name: "Test Fed Alpha", memberCount: 2 })]);
  });

  test("PATCH /api/admin/federations/[id] suspends", async () => {
    signInAs(PLATFORM_ADMIN);
    prismaMock.federation.findUnique.mockResolvedValue(federationRow as never);
    prismaMock.federation.update.mockImplementation((async ({ data }: any) => ({ ...federationRow, ...data })) as never);

    const { status, body } = await readJson(
      await ADMIN_PATCH(jsonRequest("PATCH", "/", { status: "SUSPENDED" }), idParams(FED)),
    );

    expect(status).toBe(200);
    expect(body.status).toBe("SUSPENDED");
    expect(prismaMock.federation.update).toHaveBeenCalledWith({ where: { id: FED }, data: { status: "SUSPENDED" } });
  });

  test("TENANT_ADMIN gets 403 on admin route", async () => {
    signInAs(ADMIN1);

    const { status } = await readJson(await ADMIN_LIST());

    expect(status).toBe(403);
    expect(prismaMock.federation.findMany).not.toHaveBeenCalled();
  });
});
