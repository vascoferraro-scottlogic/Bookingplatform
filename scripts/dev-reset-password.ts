// One-shot dev helper: list tenants + their TENANT_ADMIN users, optionally
// reset a user's password. Run with the app's own prisma client so env+config
// match exactly. Usage:
//   npx tsx scripts/dev-reset-password.ts                  -> just list
//   npx tsx scripts/dev-reset-password.ts <email> <pw>     -> set password
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import bcrypt from "bcryptjs";

const [, , emailArg, pwArg] = process.argv;

async function main() {
  if (emailArg && pwArg) {
    const hash = await bcrypt.hash(pwArg, 10);
    const updated = await prisma.user.update({
      where: { email: emailArg.toLowerCase() },
      data: { passwordHash: hash },
      select: { id: true, email: true, name: true, role: true },
    });
    console.log("Password reset for:", updated);
    return;
  }
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true, slug: true, status: true },
  });
  for (const t of tenants) {
    const ms = await prisma.membership.findMany({
      where: { tenantId: t.id, role: "TENANT_ADMIN" },
      include: { user: { select: { email: true, name: true } } },
    });
    console.log(`${t.slug} [${t.status}] (${t.name})`);
    for (const m of ms) {
      console.log(`  TENANT_ADMIN  ${m.user.email}  membership=${m.status}`);
    }
  }
  console.log("\nTo reset a password:");
  console.log("  npx tsx scripts/dev-reset-password.ts <email> <newPassword>");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
