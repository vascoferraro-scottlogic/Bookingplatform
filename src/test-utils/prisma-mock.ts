// Deep mock of the Prisma client for unit tests.
//
// Usage in a test file:
//
//   jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
//   import { prismaMock } from "@/test-utils/prisma-mock";
//
//   prismaMock.booking.findUnique.mockResolvedValue({ id: "b1", ... } as never);
//
// Every model method is a jest mock that resolves to `undefined` unless a test
// sets a value. A fresh mock is created before each test. `$transaction` runs an
// interactive callback against the same mock, or resolves an array of promises.
import { mockDeep, type DeepMockProxy } from "jest-mock-extended";
import type { PrismaClient } from "@prisma/client";

function createMock(): DeepMockProxy<PrismaClient> {
  const m = mockDeep<PrismaClient>({
    fallbackMockImplementation: () => Promise.resolve(undefined),
  });
  m.$transaction.mockImplementation(((arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: unknown) => unknown)(m);
    return Promise.all(arg as Promise<unknown>[]);
  }) as never);
  // Module flags (FR-FLAG-002) are ON unless a test turns one off; a missing row would read as off.
  m.featureFlag.findUnique.mockImplementation((async ({ where }: any) => ({
    tenantId: where.tenantId_key.tenantId,
    key: where.tenantId_key.key,
    enabled: true,
  })) as never);
  return m;
}

let current = createMock();

beforeEach(() => {
  current = createMock();
});

// Stable references that always forward to the current test's mock, so code
// that captured `prisma` at import time sees the fresh mock in every test.
export const prismaMock = new Proxy({} as DeepMockProxy<PrismaClient>, {
  get: (_t, prop) => (current as never)[prop],
});

export const prismaModule = { prisma: prismaMock };
