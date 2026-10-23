// Unit tests must not use the database.
//
// By default every test file gets a `@/lib/prisma` whose every property throws.
// A test that needs data access mocks Prisma explicitly, which replaces this
// guard for that file:
//
//   jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
//   import { prismaMock } from "@/test-utils/prisma-mock";
//
// Behaviour that needs a real database (tenant isolation, races, history
// retention) is covered by the API and UI test suites, not by Jest.
jest.mock("@/lib/prisma", () => {
  const fail = (prop: PropertyKey): never => {
    throw new Error(
      `Unit tests must not use the database (accessed prisma.${String(prop)}). ` +
        `Mock it: jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule)`,
    );
  };
  const guard = new Proxy({}, { get: (_t, prop) => (prop === "then" ? undefined : fail(prop)) });
  return { prisma: guard };
});
