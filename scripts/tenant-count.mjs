// Prints the number of Tenant rows (or "error") so the init script can decide
// whether a fresh database needs seeding. Kept dependency-light: reuses the
// app's Prisma + pg driver adapter.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

try {
  const count = await prisma.tenant.count();
  process.stdout.write(String(count));
} catch {
  process.stdout.write("error");
} finally {
  await prisma.$disconnect();
}
