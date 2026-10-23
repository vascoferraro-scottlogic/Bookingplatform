/**
 * Messaging API tenant isolation and channel management (B-06, B-07, B-66).
 */
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, routeParams } from "@/test-utils/http";
import { POST as channelsPOST } from "@/app/api/messaging/channels/route";
import { PATCH as channelPATCH } from "@/app/api/messaging/channels/[id]/route";
import { POST as messagesPOST } from "@/app/api/messaging/channels/[id]/messages/route";
import { POST as membersPOST } from "@/app/api/messaging/channels/[id]/members/route";

const TENANT = "tenant-1";
const OTHER_TENANT = "tenant-2";
const MEMBER = "member-1";
const ADMIN = "admin-1";
const FOREIGN_USER = "foreign-1"; // belongs to OTHER_TENANT only
const LOCAL_USER = "local-1"; // belongs to TENANT

const USERS: Record<string, { id: string; tenantId: string }> = {
  [MEMBER]: { id: MEMBER, tenantId: TENANT },
  [ADMIN]: { id: ADMIN, tenantId: TENANT },
  [LOCAL_USER]: { id: LOCAL_USER, tenantId: TENANT },
  [FOREIGN_USER]: { id: FOREIGN_USER, tenantId: OTHER_TENANT },
};
const MEMBERSHIPS = Object.values(USERS).map((u, i) => ({
  id: `m-${i}`,
  userId: u.id,
  tenantId: u.tenantId,
  role: "USER",
  kind: "MEMBER",
  status: "ACTIVE",
}));

function channel(overrides: Record<string, unknown> = {}) {
  return {
    id: "ch-1",
    tenantId: TENANT,
    name: "general",
    description: null,
    type: "PUBLIC",
    createdById: ADMIN,
    createdAt: new Date(),
    updatedAt: new Date(),
    members: [
      { id: "cm-1", channelId: "ch-1", userId: MEMBER, role: "MEMBER", mutedUntil: null, user: { id: MEMBER, name: null, email: "m@x" } },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  // Messaging flag on; every other flag on too.
  prismaMock.featureFlag.findUnique.mockResolvedValue({ enabled: true } as never);

  // Tenant membership lookups answer like the DB would, however a fix asks.
  const userInTenant = (userId: string, tenantId: string) => USERS[userId]?.tenantId === tenantId;
  prismaMock.membership.findUnique.mockImplementation((async ({ where }: any) => {
    const k = where?.userId_tenantId;
    return k ? MEMBERSHIPS.find((m) => m.userId === k.userId && m.tenantId === k.tenantId) ?? null : null;
  }) as never);
  prismaMock.membership.findFirst.mockImplementation((async ({ where }: any) =>
    MEMBERSHIPS.find((m) => m.userId === where?.userId && (!where?.tenantId || m.tenantId === where.tenantId)) ?? null) as never);
  prismaMock.membership.findMany.mockImplementation((async ({ where }: any = {}) =>
    MEMBERSHIPS.filter((m) =>
      (!where?.tenantId || m.tenantId === where.tenantId) &&
      (!where?.userId || (typeof where.userId === "string" ? m.userId === where.userId : where.userId.in?.includes(m.userId))),
    )) as never);
  prismaMock.membership.count.mockImplementation((async ({ where }: any = {}) =>
    MEMBERSHIPS.filter((m) =>
      (!where?.tenantId || m.tenantId === where.tenantId) &&
      (!where?.userId || (typeof where.userId === "string" ? m.userId === where.userId : where.userId.in?.includes(m.userId))),
    ).length) as never);
  prismaMock.user.findUnique.mockImplementation((async ({ where }: any) =>
    USERS[where?.id] ? { ...USERS[where.id], memberships: MEMBERSHIPS.filter((m) => m.userId === where.id) } : null) as never);
  prismaMock.user.findFirst.mockImplementation((async ({ where }: any) => {
    const u = USERS[where?.id];
    if (!u) return null;
    if (where.tenantId && !userInTenant(u.id, where.tenantId)) return null;
    if (where.memberships?.some?.tenantId && !userInTenant(u.id, where.memberships.some.tenantId)) return null;
    return u;
  }) as never);
  prismaMock.user.findMany.mockImplementation((async ({ where }: any = {}) =>
    Object.values(USERS).filter((u) =>
      (!where?.id?.in || where.id.in.includes(u.id)) &&
      (!where?.tenantId || u.tenantId === where.tenantId) &&
      (!where?.memberships?.some?.tenantId || u.tenantId === where.memberships.some.tenantId),
    )) as never);
  prismaMock.user.count.mockImplementation((async ({ where }: any = {}) =>
    Object.values(USERS).filter((u) =>
      (!where?.id?.in || where.id.in.includes(u.id)) &&
      (!where?.tenantId || u.tenantId === where.tenantId) &&
      (!where?.memberships?.some?.tenantId || u.tenantId === where.memberships.some.tenantId),
    ).length) as never);

  prismaMock.channel.create.mockImplementation((async ({ data }: any) => ({ id: "ch-new", ...data, members: [] })) as never);
  prismaMock.channel.update.mockImplementation((async ({ data }: any) => ({ ...channel(), ...data })) as never);
  prismaMock.message.create.mockImplementation((async ({ data }: any) => ({ id: "msg-1", ...data, createdAt: new Date(), user: { id: data.userId } })) as never);
  prismaMock.channelMember.create.mockImplementation((async ({ data }: any) => ({ id: "cm-new", ...data })) as never);
});

const ctx = (id = "ch-1") => routeParams({ id });

describe("POST /api/messaging/channels/[id]/messages", () => {
  test("[B-06] FR-MSG-004 – posting to another tenant's channel returns 404 and stores nothing", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(channel({ tenantId: OTHER_TENANT }) as never);
    // Even if a membership row exists (e.g. stale data), the tenant boundary wins.
    prismaMock.channelMember.findUnique.mockResolvedValue({ id: "cm-1", channelId: "ch-1", userId: MEMBER, role: "MEMBER", mutedUntil: null } as never);
    signInAs({ id: MEMBER, role: "USER", tenantId: TENANT });

    const res = await messagesPOST(jsonRequest("POST", "/api/messaging/channels/ch-1/messages", { body: "hello" }), ctx());

    expect(res.status).toBe(404);
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  test("[B-06] FR-SEC-005 – an impersonating admin posting is authorised by the effective role and writes to the impersonated tenant", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(channel() as never);
    prismaMock.channelMember.findUnique.mockResolvedValue(null); // not a channel member
    signInAs({
      id: "platform-1",
      role: "PLATFORM_ADMIN",
      tenantId: null,
      actingAs: { tenantId: TENANT, role: "TENANT_ADMIN", impersonationId: "imp-1", startedAt: new Date().toISOString() },
    });

    const res = await messagesPOST(jsonRequest("POST", "/api/messaging/channels/ch-1/messages", { body: "hello" }), ctx());

    expect(res.status).toBe(201);
    expect(prismaMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: TENANT, channelId: "ch-1" }) }),
    );
  });
});

describe("POST /api/messaging/channels/[id]/members", () => {
  test("[B-07] FR-MSG-004 – adding a channel member from another tenant returns 400", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(channel() as never);
    prismaMock.channelMember.findUnique.mockResolvedValue(null);
    signInAs({ id: ADMIN, role: "TENANT_ADMIN", tenantId: TENANT });

    const res = await membersPOST(jsonRequest("POST", "/api/messaging/channels/ch-1/members", { userId: FOREIGN_USER }), ctx());

    expect(res.status).toBe(400);
    expect(prismaMock.channelMember.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/messaging/channels", () => {
  const createChannel = (body: unknown) => channelsPOST(jsonRequest("POST", "/api/messaging/channels", body));

  test("[B-07] FR-MSG-004 – a DM with a user from another tenant returns 400", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(null);
    signInAs({ id: MEMBER, role: "USER", tenantId: TENANT });

    const res = await createChannel({ targetUserId: FOREIGN_USER });

    expect(res.status).toBe(400);
    expect(prismaMock.channel.create).not.toHaveBeenCalled();
  });

  test("[B-07] FR-MSG-004 – creating a channel with members from another tenant returns 400", async () => {
    signInAs({ id: ADMIN, role: "TENANT_ADMIN", tenantId: TENANT });

    const res = await createChannel({ name: "team", type: "PRIVATE", memberIds: [LOCAL_USER, FOREIGN_USER] });

    expect(res.status).toBe(400);
    expect(prismaMock.channel.create).not.toHaveBeenCalled();
  });

  test("[B-07] FR-MSG-004 – creating a channel with a reserved 'dm:' name returns 400", async () => {
    signInAs({ id: ADMIN, role: "TENANT_ADMIN", tenantId: TENANT });

    const res = await createChannel({ name: `dm:${LOCAL_USER}:${MEMBER}`, type: "PRIVATE" });

    expect(res.status).toBe(400);
    expect(prismaMock.channel.create).not.toHaveBeenCalled();
  });

  test.each(["USER", "GUEST"] as const)("[B-66] D-10 – a %s creating a channel gets 403", async (role) => {
    signInAs({ id: MEMBER, role, tenantId: TENANT });

    const res = await createChannel({ name: "my-channel", type: "PUBLIC" });

    expect(res.status).toBe(403);
    expect(prismaMock.channel.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/messaging/channels/[id]", () => {
  test("[B-07] FR-MSG-004 – renaming a channel to a reserved 'dm:' name returns 400", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(channel() as never);
    prismaMock.channelMember.findUnique.mockResolvedValue(null);
    signInAs({ id: ADMIN, role: "TENANT_ADMIN", tenantId: TENANT });

    const res = await channelPATCH(jsonRequest("PATCH", "/api/messaging/channels/ch-1", { name: `dm:${LOCAL_USER}:${MEMBER}` }), ctx());

    expect(res.status).toBe(400);
    expect(prismaMock.channel.update).not.toHaveBeenCalled();
  });
});
