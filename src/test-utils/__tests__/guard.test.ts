import { prisma } from "@/lib/prisma";

test("unmocked prisma throws", () => {
  expect(() => prisma.user).toThrow(/must not use the database/);
});
