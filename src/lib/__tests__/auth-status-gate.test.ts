jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);

import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prismaMock } from "@/test-utils/prisma-mock";

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
const EMAIL = "admin@example.test";
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await bcrypt.hash(PASSWORD, 4);
});

type TenantStatus = "ACTIVE" | "ONBOARDING" | "SUSPENDED" | "CHURNED";

/** A TENANT_ADMIN whose legacy User.tenantId points at a tenant with `status`. */
function givenUserWithTenant(status: TenantStatus) {
  const user = {
    id: "user-1",
    email: EMAIL,
    name: null,
    passwordHash,
    role: "TENANT_ADMIN",
    tenantId: "tenant-1",
    suspended: false,
    tenant: { id: "tenant-1", status, active: status === "ACTIVE" },
  };
  prismaMock.user.findUnique.mockResolvedValue(user as never);
  return user;
}

describe("credentials authorize() — tenant status gate", () => {
  test("ACTIVE tenant: sign-in allowed", async () => {
    const user = givenUserWithTenant("ACTIVE");
    const result = await authorize({ email: user.email, password: PASSWORD });
    expect(result).not.toBeNull();
    expect((result as any).id).toBe(user.id);
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: EMAIL },
      include: { tenant: true },
    });
  });

  test("ONBOARDING tenant: sign-in allowed (admins must drive the wizard)", async () => {
    const user = givenUserWithTenant("ONBOARDING");
    const result = await authorize({ email: user.email, password: PASSWORD });
    expect(result).not.toBeNull();
    expect((result as any).id).toBe(user.id);
  });

  test("SUSPENDED tenant: sign-in blocked", async () => {
    const user = givenUserWithTenant("SUSPENDED");
    const result = await authorize({ email: user.email, password: PASSWORD });
    expect(result).toBeNull();
  });

  test("CHURNED tenant: sign-in blocked", async () => {
    const user = givenUserWithTenant("CHURNED");
    const result = await authorize({ email: user.email, password: PASSWORD });
    expect(result).toBeNull();
  });

  test("Wrong password: sign-in blocked regardless of tenant status", async () => {
    const user = givenUserWithTenant("ACTIVE");
    const result = await authorize({ email: user.email, password: "wrong" });
    expect(result).toBeNull();
  });
});
