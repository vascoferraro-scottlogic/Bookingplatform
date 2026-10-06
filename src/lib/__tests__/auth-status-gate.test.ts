import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

// Pull the credentials provider's authorize function out of the shared
// authOptions so we can exercise the gate logic directly. NextAuth wraps the
// outer `authorize` in error-swallowing logic; the real one lives at
// `provider.options.authorize`.
const credentialsProvider = authOptions.providers[0] as any;
const authorizeFn = credentialsProvider.options?.authorize ?? credentialsProvider.authorize;
const authorize = authorizeFn as (
  credentials: { email: string; password: string } | undefined
) => Promise<unknown | null>;

const PASSWORD = "correct-horse-battery";

const cleanup: { tenantIds: string[]; userIds: string[] } = { tenantIds: [], userIds: [] };

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: cleanup.tenantIds } } });
  await prisma.$disconnect();
});

async function makeUserWithTenant(status: "ACTIVE" | "ONBOARDING" | "SUSPENDED" | "CHURNED") {
  const stamp = Date.now() + Math.random();
  const tenant = await prisma.tenant.create({
    data: {
      name: `Auth Test ${status}`,
      slug: `auth-${status.toLowerCase()}-${stamp}`,
      status,
      // Mirror the legacy active flag to whatever the seeder would set:
      // only ACTIVE is "active=true" in the new world.
      active: status === "ACTIVE",
    },
  });
  cleanup.tenantIds.push(tenant.id);
  const user = await prisma.user.create({
    data: {
      email: `auth-${status.toLowerCase()}-${stamp}@test.com`,
      passwordHash: await bcrypt.hash(PASSWORD, 8),
      role: "TENANT_ADMIN",
      tenantId: tenant.id,
    },
  });
  cleanup.userIds.push(user.id);
  return user;
}

describe("credentials authorize() — tenant status gate", () => {
  test("ACTIVE tenant: sign-in allowed", async () => {
    const user = await makeUserWithTenant("ACTIVE");
    const result = await authorize({ email: user.email, password: PASSWORD });
    expect(result).not.toBeNull();
    expect((result as any).id).toBe(user.id);
  });

  test("ONBOARDING tenant: sign-in allowed (admins must drive the wizard)", async () => {
    const user = await makeUserWithTenant("ONBOARDING");
    const result = await authorize({ email: user.email, password: PASSWORD });
    expect(result).not.toBeNull();
    expect((result as any).id).toBe(user.id);
  });

  test("SUSPENDED tenant: sign-in blocked", async () => {
    const user = await makeUserWithTenant("SUSPENDED");
    const result = await authorize({ email: user.email, password: PASSWORD });
    expect(result).toBeNull();
  });

  test("CHURNED tenant: sign-in blocked", async () => {
    const user = await makeUserWithTenant("CHURNED");
    const result = await authorize({ email: user.email, password: PASSWORD });
    expect(result).toBeNull();
  });

  test("Wrong password: sign-in blocked regardless of tenant status", async () => {
    const user = await makeUserWithTenant("ACTIVE");
    const result = await authorize({ email: user.email, password: "wrong" });
    expect(result).toBeNull();
  });
});
