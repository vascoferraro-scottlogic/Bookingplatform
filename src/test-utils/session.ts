// Session control for route-handler unit tests.
//
// Mock next-auth once per test file, then set the signed-in user per test:
//
//   jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);
//   import { signInAs, signOut } from "@/test-utils/session";
//
//   signInAs({ id: "u1", role: "USER", tenantId: "t1" });
//
// This replaces getServerSession, so it covers routes that use getSessionOrFail
// and routes that call getServerSession directly. The real jwt/session
// callbacks in src/lib/auth.ts are not involved; test those by calling
// authOptions.callbacks directly.
import type { Role } from "@prisma/client";
import type { ActingAsClaim } from "@/lib/roles";

export interface TestUser {
  id: string;
  role: Role;
  tenantId: string | null;
  email?: string;
  name?: string | null;
  actingAs?: ActingAsClaim | null;
}

let current: { user: Required<Omit<TestUser, "name">> & { name: string | null } } | null = null;

export function signInAs(user: TestUser) {
  current = {
    user: {
      email: `${user.id}@example.test`,
      name: null,
      actingAs: null,
      ...user,
    } as never,
  };
  return current;
}

export function signOut() {
  current = null;
}

beforeEach(() => signOut());

const actual = jest.requireActual("next-auth");

export const nextAuthModule = {
  __esModule: true,
  ...actual,
  default: actual.default,
  getServerSession: jest.fn(async () => current),
};
