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
    // Looked up by the (lower-case) email; the exact include is an implementation detail.
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: EMAIL } }),
    );
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

describe("[B-13] credentials authorize() — email casing", () => {
  test("[B-13] FR-AUTH-001 – login with different email casing succeeds", async () => {
    const user = {
      id: "user-1",
      email: EMAIL,
      name: null,
      passwordHash,
      role: "USER",
      tenantId: "tenant-1",
      suspended: false,
      tenant: { id: "tenant-1", status: "ACTIVE", active: true },
      memberships: [],
    };
    // Stored lower-case: only a normalised (or case-insensitive) lookup finds it.
    const lookup = async ({ where }: any) => {
      const e = where?.email;
      if (e === EMAIL) return user;
      if (e && typeof e === "object" && e.mode === "insensitive" && String(e.equals).toLowerCase() === EMAIL) return user;
      return null;
    };
    prismaMock.user.findUnique.mockImplementation(lookup as never);
    prismaMock.user.findFirst.mockImplementation(lookup as never);
    prismaMock.membership.findMany.mockResolvedValue([] as never);

    const result = await authorize({ email: "Admin@Example.TEST", password: PASSWORD });

    expect(result).not.toBeNull();
    expect((result as any).id).toBe("user-1");
  });
});

describe("[B-17] credentials authorize() — tenant status via memberships", () => {
  test("[B-17] D-08 – sign-in refused when the user's only membership is in a SUSPENDED tenant", async () => {
    const suspendedTenant = {
      id: "tenant-s",
      name: "Suspended Club",
      slug: "suspended",
      brandColor: "#000",
      status: "SUSPENDED",
      active: false,
      locality: null,
      locale: "en",
    };
    const membership = {
      id: "m1",
      userId: "user-1",
      tenantId: suspendedTenant.id,
      role: "USER",
      kind: "MEMBER",
      status: "ACTIVE",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      tenant: suspendedTenant,
    };
    // No legacy User.tenantId: the only tenant link is the membership.
    const user = {
      id: "user-1",
      email: EMAIL,
      name: null,
      passwordHash,
      role: "USER",
      tenantId: null,
      suspended: false,
      tenant: null,
      memberships: [membership],
    };
    prismaMock.user.findUnique.mockResolvedValue(user as never);
    prismaMock.user.findFirst.mockResolvedValue(user as never);
    prismaMock.membership.findMany.mockResolvedValue([membership] as never);

    const result = await authorize({ email: EMAIL, password: PASSWORD });

    expect(result).toBeNull();
  });
});
