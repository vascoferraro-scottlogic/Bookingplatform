// One-shot dev helper: list tenants + their TENANT_ADMIN users, optionally
// reset a user's password. Usage:
//   node scripts/dev-reset-password.mjs                  -> just list
//   node scripts/dev-reset-password.mjs <email> <pw>     -> set password
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const p = new PrismaClient();
const [, , emailArg, pwArg] = process.argv;

if (emailArg && pwArg) {
  const hash = await bcrypt.hash(pwArg, 10);
  const updated = await p.user.update({
    where: { email: emailArg.toLowerCase() },
    data: { passwordHash: hash },
    select: { id: true, email: true, name: true, role: true },
  });
  console.log("Password reset for:", updated);
} else {
  const tenants = await p.tenant.findMany({
    select: { id: true, name: true, slug: true, status: true },
  });
  for (const t of tenants) {
    const ms = await p.membership.findMany({
      where: { tenantId: t.id, role: "TENANT_ADMIN" },
      include: { user: { select: { email: true, name: true } } },
    });
    console.log(`${t.slug} [${t.status}] (${t.name})`);
    for (const m of ms) {
      console.log(`  TENANT_ADMIN  ${m.user.email}  membership=${m.status}`);
    }
  }
  console.log("\nTo reset a password:");
  console.log("  node scripts/dev-reset-password.mjs <email> <newPassword>");
}

await p.$disconnect();
