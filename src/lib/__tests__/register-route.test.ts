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
