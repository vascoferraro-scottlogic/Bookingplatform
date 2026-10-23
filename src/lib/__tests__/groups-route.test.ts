jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, request, readJson, routeParams } from "@/test-utils/http";

import { GET, POST } from "@/app/api/groups/route";
import { GET as GET_ONE, PATCH, DELETE } from "@/app/api/groups/[id]/route";
import { PUT as PUT_GRANTS } from "@/app/api/groups/[id]/grants/route";
import { POST as POST_MEMBER } from "@/app/api/groups/[id]/members/route";
import { DELETE as DELETE_MEMBER } from "@/app/api/groups/[id]/members/[membershipId]/route";

const TENANT_ID = "tenant-1";
const OTHER_TENANT_ID = "tenant-2";
const MEMBERSHIP_ID = "membership-1";

const CUSTOM_GROUP = { id: "g-custom", tenantId: TENANT_ID, name: "Events Committee", description: null, isBuiltIn: false };
const BUILT_IN_GROUP = { id: "g-builtin", tenantId: TENANT_ID, name: "Test Built-In", description: null, isBuiltIn: true };
const GROUPS = [CUSTOM_GROUP, BUILT_IN_GROUP];

const signInAsAdmin = (tenantId = TENANT_ID) => signInAs({ id: "grp-admin", role: "TENANT_ADMIN", tenantId });
const signInAsUser = () => signInAs({ id: "grp-user", role: "USER", tenantId: TENANT_ID });

beforeEach(() => {
  // permissionGroup.findFirst honours the id / tenantId / name / id.not filters
  // the routes build, over the two groups in TENANT_ID.
  prismaMock.permissionGroup.findFirst.mockImplementation((async ({ where }: any) => {
    const match = GROUPS.find((g) => {
      if (typeof where.id === "string" && g.id !== where.id) return false;
      if (where.id?.not && g.id === where.id.not) return false;
      if (where.tenantId !== undefined && g.tenantId !== where.tenantId) return false;
      if (where.name !== undefined && g.name !== where.name) return false;
      return true;
    });
    return match ? { ...match, grants: [], members: [] } : null;
  }) as never);
  prismaMock.permissionGroup.create.mockImplementation((async ({ data }: any) => ({
    id: "g-new",
    isBuiltIn: false,
    ...data,
    _count: { grants: 0, members: 0 },
  })) as never);
  prismaMock.permissionGroup.update.mockImplementation((async ({ where, data }: any) => ({
    ...GROUPS.find((g) => g.id === where.id),
    ...data,
  })) as never);
  prismaMock.membership.findFirst.mockImplementation((async ({ where }: any) =>
    where.id === MEMBERSHIP_ID && where.tenantId === TENANT_ID ? { id: MEMBERSHIP_ID, tenantId: TENANT_ID } : null) as never);
  prismaMock.groupMember.create.mockImplementation((async ({ data }: any) => ({ id: "gm-1", ...data })) as never);
});

describe("GET /api/groups — list", () => {
  test("TENANT_ADMIN gets groups list for their tenant", async () => {
    signInAsAdmin();
    prismaMock.permissionGroup.findMany.mockResolvedValue(GROUPS as never);

    const { status, body } = await readJson(await GET());

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(prismaMock.permissionGroup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT_ID } }),
    );
  });

  test("USER gets 403", async () => {
    signInAsUser();
    const res = await GET();
    expect(res.status).toBe(403);
    expect(prismaMock.permissionGroup.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/groups — create", () => {
  test("creates a custom group", async () => {
    signInAsAdmin();
    const { status, body } = await readJson(
      await POST(jsonRequest("POST", "/api/groups", { name: "Social Committee", description: "Runs socials" })),
    );

    expect(status).toBe(201);
    expect(body.name).toBe("Social Committee");
    expect(body.isBuiltIn).toBe(false);
    expect(prismaMock.permissionGroup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { tenantId: TENANT_ID, name: "Social Committee", description: "Runs socials", grants: undefined },
      }),
    );
  });

  test("rejects duplicate name", async () => {
    signInAsAdmin();
    prismaMock.permissionGroup.findUnique.mockResolvedValue(CUSTOM_GROUP as never);

    const res = await POST(jsonRequest("POST", "/api/groups", { name: "Events Committee" }));

    expect(res.status).toBe(409);
    expect(prismaMock.permissionGroup.findUnique).toHaveBeenCalledWith({
      where: { tenantId_name: { tenantId: TENANT_ID, name: "Events Committee" } },
    });
    expect(prismaMock.permissionGroup.create).not.toHaveBeenCalled();
  });

  test("rejects empty name", async () => {
    signInAsAdmin();
    const res = await POST(jsonRequest("POST", "/api/groups", { name: "  " }));
    expect(res.status).toBe(400);
    expect(prismaMock.permissionGroup.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/groups/[id] — detail", () => {
  test("returns group with grants and members", async () => {
    signInAsAdmin();
    const { status, body } = await readJson(await GET_ONE(request("/api/groups/g-custom"), routeParams({ id: CUSTOM_GROUP.id })));

    expect(status).toBe(200);
    expect(body.name).toBe("Events Committee");
    expect(Array.isArray(body.grants)).toBe(true);
    expect(Array.isArray(body.members)).toBe(true);
  });

  test("returns 404 when the group belongs to another tenant", async () => {
    signInAsAdmin(OTHER_TENANT_ID);
    const res = await GET_ONE(request("/api/groups/g-custom"), routeParams({ id: CUSTOM_GROUP.id }));

    expect(res.status).toBe(404);
    expect(prismaMock.permissionGroup.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CUSTOM_GROUP.id, tenantId: OTHER_TENANT_ID } }),
    );
  });
});

describe("PATCH /api/groups/[id] — update", () => {
  test("renames a custom group", async () => {
    signInAsAdmin();
    const { status, body } = await readJson(
      await PATCH(jsonRequest("PATCH", "/api/groups/g-custom", { name: "Social Committee" }), routeParams({ id: CUSTOM_GROUP.id })),
    );

    expect(status).toBe(200);
    expect(body.name).toBe("Social Committee");
    expect(prismaMock.permissionGroup.update).toHaveBeenCalledWith({
      where: { id: CUSTOM_GROUP.id },
      data: { name: "Social Committee" },
    });
  });

  test("cannot rename a built-in group", async () => {
    signInAsAdmin();
    const res = await PATCH(jsonRequest("PATCH", "/api/groups/g-builtin", { name: "Renamed" }), routeParams({ id: BUILT_IN_GROUP.id }));
    expect(res.status).toBe(400);
    expect(prismaMock.permissionGroup.update).not.toHaveBeenCalled();
  });
});

describe("PUT /api/groups/[id]/grants — replace grants", () => {
  test("replaces all grants", async () => {
    signInAsAdmin();
    const permissions = ["events_view", "events_create", "events_manage"];
    prismaMock.permissionGroup.findUnique.mockResolvedValue({
      ...CUSTOM_GROUP,
      grants: permissions.map((permission, i) => ({ id: `pg-${i}`, permission })),
    } as never);

    const { status, body } = await readJson(
      await PUT_GRANTS(jsonRequest("PUT", "/api/groups/g-custom/grants", { permissions }), routeParams({ id: CUSTOM_GROUP.id })),
    );

    expect(status).toBe(200);
    expect(body.grants).toHaveLength(3);
    expect(body.grants.map((g: any) => g.permission).sort()).toEqual(["events_create", "events_manage", "events_view"]);

    // Old grants are wiped and each new one created, in one transaction.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.permissionGrant.deleteMany).toHaveBeenCalledWith({ where: { groupId: CUSTOM_GROUP.id } });
    expect(prismaMock.permissionGrant.create.mock.calls.map(([a]) => (a as any).data)).toEqual(
      permissions.map((permission) => ({ groupId: CUSTOM_GROUP.id, permission })),
    );
  });
});

describe("POST/DELETE /api/groups/[id]/members — member management", () => {
  test("adds a member to a group", async () => {
    signInAsAdmin();
    const { status, body } = await readJson(
      await POST_MEMBER(jsonRequest("POST", "/api/groups/g-custom/members", { membershipId: MEMBERSHIP_ID }), routeParams({ id: CUSTOM_GROUP.id })),
    );

    expect(status).toBe(201);
    expect(body.membershipId).toBe(MEMBERSHIP_ID);
    expect(prismaMock.membership.findFirst).toHaveBeenCalledWith({ where: { id: MEMBERSHIP_ID, tenantId: TENANT_ID } });
    expect(prismaMock.groupMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { groupId: CUSTOM_GROUP.id, membershipId: MEMBERSHIP_ID } }),
    );
  });

  test("rejects duplicate member", async () => {
    signInAsAdmin();
    prismaMock.groupMember.findUnique.mockResolvedValue({ id: "gm-1" } as never);

    const res = await POST_MEMBER(
      jsonRequest("POST", "/api/groups/g-custom/members", { membershipId: MEMBERSHIP_ID }),
      routeParams({ id: CUSTOM_GROUP.id }),
    );

    expect(res.status).toBe(409);
    expect(prismaMock.groupMember.create).not.toHaveBeenCalled();
  });

  test("removes a member from a group", async () => {
    signInAsAdmin();
    prismaMock.groupMember.findUnique.mockResolvedValue({ id: "gm-1" } as never);

    const res = await DELETE_MEMBER(
      request("/api/groups/g-custom/members/membership-1", { method: "DELETE" }),
      routeParams({ id: CUSTOM_GROUP.id, membershipId: MEMBERSHIP_ID }),
    );

    expect(res.status).toBe(200);
    expect(prismaMock.groupMember.findUnique).toHaveBeenCalledWith({
      where: { groupId_membershipId: { groupId: CUSTOM_GROUP.id, membershipId: MEMBERSHIP_ID } },
    });
    expect(prismaMock.groupMember.delete).toHaveBeenCalledWith({ where: { id: "gm-1" } });
  });

  test("removing a member who is not in the group returns 404", async () => {
    signInAsAdmin();
    prismaMock.groupMember.findUnique.mockResolvedValue(null);

    const res = await DELETE_MEMBER(
      request("/api/groups/g-custom/members/membership-1", { method: "DELETE" }),
      routeParams({ id: CUSTOM_GROUP.id, membershipId: MEMBERSHIP_ID }),
    );

    expect(res.status).toBe(404);
    expect(prismaMock.groupMember.delete).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/groups/[id] — delete", () => {
  test("cannot delete built-in group", async () => {
    signInAsAdmin();
    const res = await DELETE(request("/api/groups/g-builtin", { method: "DELETE" }), routeParams({ id: BUILT_IN_GROUP.id }));
    expect(res.status).toBe(400);
    expect(prismaMock.permissionGroup.delete).not.toHaveBeenCalled();
  });

  test("deletes a custom group", async () => {
    signInAsAdmin();
    const res = await DELETE(request("/api/groups/g-custom", { method: "DELETE" }), routeParams({ id: CUSTOM_GROUP.id }));
    expect(res.status).toBe(200);
    expect(prismaMock.permissionGroup.delete).toHaveBeenCalledWith({ where: { id: CUSTOM_GROUP.id } });
  });

  test("a group that no longer exists returns 404", async () => {
    signInAsAdmin();
    const res = await GET_ONE(request("/api/groups/g-gone"), routeParams({ id: "g-gone" }));
    expect(res.status).toBe(404);
  });
});
