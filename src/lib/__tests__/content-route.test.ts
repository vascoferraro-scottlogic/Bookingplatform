jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { readJson, request, routeParams } from "@/test-utils/http";
import { GET as GET_ONE, DELETE } from "@/app/api/content/[id]/route";

const TENANT = "tenant-1";
const ADMIN = { id: "admin-1", role: "TENANT_ADMIN" as const, tenantId: TENANT };
const USER = { id: "user-1", role: "USER" as const, tenantId: TENANT };

const section = (id: string, status: string, overrides: Record<string, unknown> = {}) => ({
  id, tenantId: TENANT, type: "ABOUT", status, enabled: true, order: 0, title: id, content: "{}",
  createdById: ADMIN.id, updatedById: null, createdAt: new Date(), updatedAt: new Date(), ...overrides,
});
const SECTIONS = [
  section("s-draft", "DRAFT"),
  section("s-review", "REVIEW"),
  section("s-published", "PUBLISHED"),
  section("s-archived", "ARCHIVED"),
];

/** Field equality plus `{ in: [...] }`: the subset of `where` these lookups use. */
const matches = (row: Record<string, unknown>, where: Record<string, any> = {}) =>
  Object.entries(where).every(([k, v]) =>
    v && typeof v === "object" && "in" in v ? v.in.includes(row[k]) : row[k] === v);

beforeEach(() => {
  const find = (async (a: any = {}) => SECTIONS.find((s) => matches(s, a.where)) ?? null) as never;
  prismaMock.contentSection.findFirst.mockImplementation(find);
  prismaMock.contentSection.findUnique.mockImplementation(find);
  prismaMock.contentSection.update.mockImplementation((async ({ where, data }: any) => ({
    ...SECTIONS.find((s) => s.id === where.id),
    ...data,
  })) as never);
  prismaMock.contentSection.delete.mockImplementation((async ({ where }: any) => SECTIONS.find((s) => s.id === where.id)) as never);
  prismaMock.auditEvent.create.mockResolvedValue({} as never);
});

const getOne = (id: string) => GET_ONE(request(`/api/content/${id}`), routeParams({ id }));
const del = (id: string) => DELETE(request(`/api/content/${id}`, { method: "DELETE" }), routeParams({ id }));

describe("GET /api/content/[id]", () => {
  test("[B-70] FR-CMS-001 – a member can read a PUBLISHED section", async () => {
    signInAs(USER);

    const { status, body } = await readJson(await getOne("s-published"));

    expect(status).toBe(200);
    expect(body.id).toBe("s-published");
  });

  test.each(["s-draft", "s-review", "s-archived"])(
    "[B-70] FR-CMS-001 – a member GET of an unpublished section (%s) returns 404",
    async (id) => {
      signInAs(USER);

      const { status } = await readJson(await getOne(id));

      expect(status).toBe(404);
    },
  );

  test("[B-70] FR-CMS-001 – a tenant admin can still read an unpublished section", async () => {
    signInAs(ADMIN);

    const { status } = await readJson(await getOne("s-review"));

    expect(status).toBe(200);
  });
});

describe("DELETE /api/content/[id]", () => {
  test("[B-70] FR-CMS-001 – DELETE of a section in REVIEW returns 409 and leaves it unchanged", async () => {
    signInAs(ADMIN);

    const { status } = await readJson(await del("s-review"));

    // REVIEW → ARCHIVED is not a lifecycle transition, so it can't be archived either.
    expect(status).toBe(409);
    expect(prismaMock.contentSection.update).not.toHaveBeenCalled();
    expect(prismaMock.contentSection.delete).not.toHaveBeenCalled();
  });

  test("[B-70] FR-CMS-001 – DELETE of a DRAFT section deletes it", async () => {
    signInAs(ADMIN);

    const { status, body } = await readJson(await del("s-draft"));

    expect(status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(prismaMock.contentSection.delete).toHaveBeenCalledWith({ where: { id: "s-draft" } });
  });

  test("[B-70] FR-CMS-001 – DELETE of a PUBLISHED section archives it (PUBLISHED → ARCHIVED is allowed)", async () => {
    signInAs(ADMIN);

    const { status, body } = await readJson(await del("s-published"));

    expect(status).toBe(200);
    expect(body.status).toBe("ARCHIVED");
    expect(prismaMock.contentSection.delete).not.toHaveBeenCalled();
  });
});
