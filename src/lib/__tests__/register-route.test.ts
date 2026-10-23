jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);

import bcrypt from "bcryptjs";
import { prismaMock } from "@/test-utils/prisma-mock";
import { jsonRequest, readJson } from "@/test-utils/http";
import { POST } from "@/app/api/auth/register/route";

const register = (body: Record<string, unknown>) => POST(jsonRequest("POST", "/api/auth/register", body));

beforeEach(() => {
  // user.create echoes the selected fields of what it was given.
  prismaMock.user.create.mockImplementation((async ({ data }: any) => ({
    id: "new-user",
    email: data.email,
    name: data.name ?? null,
    role: data.role,
    tenantId: data.tenantId,
  })) as never);
});

describe("POST /api/auth/register", () => {
  test("registers a new user with email and password", async () => {
    const { status, body } = await readJson(await register({ email: "new@test.com", password: "Pass1234" }));

    expect(status).toBe(201);
    expect(body).toEqual({ id: "new-user", email: "new@test.com", name: null, role: "USER", tenantId: null });
  });

  test("stores a bcrypt hash, never the plain password", async () => {
    await register({ email: "new@test.com", password: "Pass1234" });

    const data = (prismaMock.user.create.mock.calls[0][0] as any).data;
    expect(data.passwordHash).not.toBe("Pass1234");
    await expect(bcrypt.compare("Pass1234", data.passwordHash)).resolves.toBe(true);
  });

  test("registers user with name", async () => {
    const { status, body } = await readJson(
      await register({ email: "new@test.com", password: "Pass1234", name: "John" }),
    );

    expect(status).toBe(201);
    expect(body.name).toBe("John");
  });

  test("returns 400 when email is missing", async () => {
    const { status, body } = await readJson(await register({ password: "Pass1234" }));

    expect(status).toBe(400);
    expect(body.error).toContain("Email and password required");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  test("returns 400 when password is missing", async () => {
    const { status } = await readJson(await register({ email: "test@test.com" }));

    expect(status).toBe(400);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  test("returns 409 for duplicate email", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "existing" } as never);

    const { status, body } = await readJson(await register({ email: "dup@test.com", password: "Pass5678" }));

    expect(status).toBe(409);
    expect(body.error).toContain("already registered");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  test("links user to tenant when valid tenantSlug provided", async () => {
    prismaMock.tenant.findFirst.mockResolvedValue({ id: "tenant-1" } as never);

    const { status, body } = await readJson(
      await register({ email: "new@test.com", password: "Pass1234", tenantSlug: "lakeview" }),
    );

    expect(status).toBe(201);
    expect(body.tenantId).toBe("tenant-1");
    expect(prismaMock.tenant.findFirst).toHaveBeenCalledWith({ where: { slug: "lakeview", active: true } });
  });

  test("returns 404 for invalid tenantSlug", async () => {
    prismaMock.tenant.findFirst.mockResolvedValue(null);

    const { status, body } = await readJson(
      await register({ email: "new@test.com", password: "Pass1234", tenantSlug: "nonexistent-slug" }),
    );

    expect(status).toBe(404);
    expect(body.error).toContain("Club not found");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});

// ─── Required behaviour (B-13) ───────────────────────────────

/** True when a membership for (tenantId, role USER, ACTIVE or default status) was written, by any route. */
function membershipCreatedFor(tenantId: string): boolean {
  const writes: any[] = [
    ...prismaMock.membership.create.mock.calls.map(([a]: any) => a?.data),
    ...prismaMock.membership.upsert.mock.calls.map(([a]: any) => a?.create),
    ...prismaMock.membership.createMany.mock.calls.flatMap(([a]: any) => [].concat(a?.data ?? [])),
  ];
  // Nested create inside user.create({ data: { memberships: { create: ... } } }).
  for (const [arg] of prismaMock.user.create.mock.calls as any[]) {
    const nested = arg?.data?.memberships?.create;
    if (nested) writes.push(...[].concat(nested).map((m: any) => ({ userId: "new-user", ...m })));
  }
  return writes.some(
    (d) =>
      d &&
      (d.tenantId === tenantId || d.tenant?.connect?.id === tenantId) &&
      (d.role === undefined || d.role === "USER") &&
      (d.status === undefined || d.status === "ACTIVE"),
  );
}

describe("[B-13] POST /api/auth/register — email normalisation, validation, membership", () => {
  test("[B-13] FR-AUTH-001 – an email differing only in case from an existing one is a duplicate (409)", async () => {
    // The existing account is stored lower-case; only a lower-cased (or
    // case-insensitive) lookup finds it.
    const existing = { id: "existing", email: "dup@test.com" };
    const lookup = async ({ where }: any) => {
      const e = where?.email;
      if (e === "dup@test.com") return existing;
      if (e && typeof e === "object" && e.mode === "insensitive" && String(e.equals).toLowerCase() === "dup@test.com") return existing;
      return null;
    };
    prismaMock.user.findUnique.mockImplementation(lookup as never);
    prismaMock.user.findFirst.mockImplementation(lookup as never);

    const { status } = await readJson(await register({ email: "DUP@Test.com", password: "Pass5678" }));

    expect(status).toBe(409);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  test("[B-13] FR-AUTH-001 – new emails are stored lower-case", async () => {
    const { status } = await readJson(await register({ email: "New.Member@Test.COM", password: "Pass1234" }));

    expect(status).toBe(201);
    const data = (prismaMock.user.create.mock.calls[0][0] as any).data;
    expect(data.email).toBe("new.member@test.com");
  });

  test("[B-13] FR-AUTH-002 – a password under 8 characters is rejected (400)", async () => {
    const { status } = await readJson(await register({ email: "new@test.com", password: "Ab1234" }));

    expect(status).toBe(400);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  test("[B-13] FR-AUTH-002 – a malformed email is rejected (400)", async () => {
    const { status } = await readJson(await register({ email: "not-an-email", password: "Pass1234" }));

    expect(status).toBe(400);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  test.each(["SUSPENDED", "CHURNED"])("[B-17] registering into a %s club is refused (403, no user created)", async (clubStatus) => {
    prismaMock.tenant.findFirst.mockResolvedValue({ id: "tenant-1", slug: "lakeview", status: clubStatus, active: true } as never);

    const { status } = await readJson(
      await register({ email: "new@test.com", password: "Pass1234", tenantSlug: "lakeview" }),
    );

    expect(status).toBe(403);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  test("[B-13] FR-AUTH-001 – registering with a tenantSlug creates an ACTIVE USER Membership in that tenant", async () => {
    prismaMock.tenant.findFirst.mockResolvedValue({ id: "tenant-1", slug: "lakeview", status: "ACTIVE", active: true } as never);
    prismaMock.tenant.findUnique.mockResolvedValue({ id: "tenant-1", slug: "lakeview", status: "ACTIVE", active: true } as never);
    prismaMock.membership.create.mockResolvedValue({ id: "m1" } as never);

    const { status } = await readJson(
      await register({ email: "new@test.com", password: "Pass1234", tenantSlug: "lakeview" }),
    );

    expect(status).toBe(201);
    expect(membershipCreatedFor("tenant-1")).toBe(true);
  });
});
