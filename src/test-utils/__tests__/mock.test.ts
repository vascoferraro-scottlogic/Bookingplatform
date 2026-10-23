jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
import { prisma } from "@/lib/prisma";
import { prismaMock } from "@/test-utils/prisma-mock";

test("explicit mock overrides the guard", async () => {
  prismaMock.user.findUnique.mockResolvedValue({ id: "u1" } as never);
  await expect(prisma.user.findUnique({ where: { id: "u1" } })).resolves.toEqual({ id: "u1" });
});

test("mock is reset between tests", async () => {
  await expect(prisma.user.findUnique({ where: { id: "u1" } })).resolves.toBeUndefined();
  expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
});

test("$transaction runs callbacks against the mock", async () => {
  prismaMock.user.count.mockResolvedValue(3);
  await expect(prisma.$transaction(async (tx) => tx.user.count())).resolves.toBe(3);
});
