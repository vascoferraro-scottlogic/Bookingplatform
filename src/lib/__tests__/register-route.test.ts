import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

// Import the route handler
import { POST } from "@/app/api/auth/register/route";

let tenantId: string;
let tenantSlug: string;
const createdUserIds: string[] = [];

beforeAll(async () => {
  tenantSlug = "reg-test-" + Date.now();
  const tenant = await prisma.tenant.create({
    data: { name: "Register Test Club", slug: tenantSlug, active: true },
  });
  tenantId = tenant.id;
});

afterAll(async () => {
  if (createdUserIds.length) {
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  // Also clean up any users created with our test tenant that we might have missed
  await prisma.auditEvent.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/register", () => {
  test("registers a new user with email and password", async () => {
    const email = `reg-success-${Date.now()}@test.com`;
    const res = await POST(makeRequest({ email, password: "Pass1234" }));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.email).toBe(email);
    expect(body.role).toBe("USER");
    expect(body.tenantId).toBeNull();
    createdUserIds.push(body.id);
  });

  test("registers user with name", async () => {
    const email = `reg-name-${Date.now()}@test.com`;
    const res = await POST(makeRequest({ email, password: "Pass1234", name: "John" }));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.name).toBe("John");
    createdUserIds.push(body.id);
  });

  test("returns 400 when email is missing", async () => {
    const res = await POST(makeRequest({ password: "Pass1234" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Email and password required");
  });

  test("returns 400 when password is missing", async () => {
    const res = await POST(makeRequest({ email: "test@test.com" }));
    expect(res.status).toBe(400);
  });

  test("returns 409 for duplicate email", async () => {
    const email = `reg-dup-${Date.now()}@test.com`;
    const first = await POST(makeRequest({ email, password: "Pass1234" }));
    const firstBody = await first.json();
    createdUserIds.push(firstBody.id);

    const second = await POST(makeRequest({ email, password: "Pass5678" }));
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error).toContain("already registered");
  });

  test("links user to tenant when valid tenantSlug provided", async () => {
    const email = `reg-tenant-${Date.now()}@test.com`;
    const res = await POST(makeRequest({ email, password: "Pass1234", tenantSlug }));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.tenantId).toBe(tenantId);
    createdUserIds.push(body.id);
  });

  test("returns 404 for invalid tenantSlug", async () => {
    const email = `reg-badslug-${Date.now()}@test.com`;
    const res = await POST(makeRequest({ email, password: "Pass1234", tenantSlug: "nonexistent-slug" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Club not found");
  });
});
