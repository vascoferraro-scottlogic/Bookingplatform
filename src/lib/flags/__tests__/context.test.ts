jest.mock("@/lib/prisma", () => ({
  prisma: {
    groupMember: {
      findMany: jest.fn(),
    },
  },
}));

import { buildContext } from "@/lib/flags/context";
import type { AppSession } from "@/lib/api-utils";

const prismaMock = jest.requireMock("@/lib/prisma").prisma;

beforeEach(() => {
  jest.resetAllMocks();
  prismaMock.groupMember.findMany.mockResolvedValue([]);
});

function session(overrides: Partial<AppSession["user"]> = {}): AppSession {
  return {
    user: {
      id: "u1",
      email: "u1@example.com",
      role: "USER",
      tenantId: "t1",
      actingAs: null,
      ...overrides,
    },
  };
}

test("unauthenticated → GUEST cohort with no user identity", async () => {
  const ctx = await buildContext(null);
  expect(ctx).toEqual({ properties: { role: "GUEST" } });
  expect(ctx.userId).toBeUndefined();
  expect(prismaMock.groupMember.findMany).not.toHaveBeenCalled();
});

test("normal session emits effective role, tenant, email and userId", async () => {
  const ctx = await buildContext(session());
  expect(ctx.userId).toBe("u1");
  expect(ctx.properties).toMatchObject({
    role: "USER",
    tenantId: "t1",
    email: "u1@example.com",
  });
});

test("custom permission groups become space-delimited grp:<id> tokens", async () => {
  prismaMock.groupMember.findMany.mockResolvedValue([
    { groupId: "g1" },
    { groupId: "g2" },
  ]);
  const ctx = await buildContext(session());
  expect(ctx.properties?.groups).toBe("grp:g1 grp:g2");
  // CUSTOM groups only.
  expect(prismaMock.groupMember.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { membership: { userId: "u1", tenantId: "t1" }, group: { isBuiltIn: false } },
    }),
  );
});

test("impersonation omits userId and uses the assumed role + tenant", async () => {
  const impersonating = session({
    role: "PLATFORM_ADMIN",
    tenantId: null,
    actingAs: {
      tenantId: "t9",
      role: "TENANT_ADMIN",
      impersonationId: "imp1",
      startedAt: new Date().toISOString(),
    },
  });
  const ctx = await buildContext(impersonating);
  expect(ctx.userId).toBeUndefined();
  expect(ctx.properties).toMatchObject({ role: "TENANT_ADMIN", tenantId: "t9" });
  // No per-user group lookup when userId is omitted.
  expect(prismaMock.groupMember.findMany).not.toHaveBeenCalled();
});

test("remoteAddress is taken from the first x-forwarded-for hop", async () => {
  const req = new Request("https://example.com", {
    headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
  });
  const ctx = await buildContext(session(), req);
  expect(ctx.remoteAddress).toBe("203.0.113.5");
});
