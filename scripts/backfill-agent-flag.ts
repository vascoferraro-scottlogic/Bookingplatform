// One-shot backfill: ensure every existing tenant has the `agent` feature
// flag set to true. The maintenance agent is mandatory for every club —
// approval now provisions this on automatically, but tenants created before
// that change need backfilling.
//
//   npx tsx scripts/backfill-agent-flag.ts          -> dry-run (just reports)
//   npx tsx scripts/backfill-agent-flag.ts --apply  -> actually upsert
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const apply = process.argv.includes("--apply");

async function main() {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true, slug: true },
  });
  const toFix: { id: string; slug: string; name: string; current: "missing" | "off" }[] = [];

  for (const t of tenants) {
    const flag = await prisma.featureFlag.findUnique({
      where: { tenantId_key: { tenantId: t.id, key: "agent" } },
      select: { enabled: true },
    });
    if (!flag) toFix.push({ ...t, current: "missing" });
    else if (!flag.enabled) toFix.push({ ...t, current: "off" });
  }

  console.log(`Tenants total: ${tenants.length}`);
  console.log(`Needing fix:   ${toFix.length}`);
  for (const t of toFix) {
    console.log(`  [${t.current}]  ${t.slug}  (${t.name})`);
  }

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to write changes.");
    return;
  }

  for (const t of toFix) {
    await prisma.featureFlag.upsert({
      where: { tenantId_key: { tenantId: t.id, key: "agent" } },
      update: { enabled: true },
      create: { tenantId: t.id, key: "agent", enabled: true },
    });
  }
  console.log(`\nApplied. ${toFix.length} tenants now have agent=on.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
