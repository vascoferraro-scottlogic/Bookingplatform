// One-shot dev helper to clean up tenants leaked by test fixtures whose
// teardown failed. Matches slugs from `onboarding-route.test.ts` (ob-test-*)
// and the detector tests (det-test-*).
//
// Usage:
//   npx tsx scripts/cleanup-test-tenants.ts            -> dry-run, list only
//   npx tsx scripts/cleanup-test-tenants.ts --apply    -> actually delete
//
// Cascade order matches the fixed test teardown in
// `src/lib/__tests__/onboarding-route.test.ts`.
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");

const SLUG_PATTERNS = ["ob-test-", "det-test-"];

async function main() {
  const tenants = await prisma.tenant.findMany({
    where: {
      OR: SLUG_PATTERNS.map((p) => ({ slug: { startsWith: p } })),
    },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      active: true,
      createdAt: true,
      _count: { select: { users: true, greens: true, bookings: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (tenants.length === 0) {
    console.log("No leaked test tenants found. Nothing to do.");
    return;
  }

  console.log(`Found ${tenants.length} leaked test tenant(s):\n`);
  for (const t of tenants) {
    const c = t._count;
    console.log(
      `  ${t.slug.padEnd(28)}  ${t.status.padEnd(11)}  active=${String(t.active).padEnd(5)}  users=${c.users}  greens=${c.greens}  bookings=${c.bookings}  (${t.createdAt.toISOString().slice(0, 10)})`,
    );
  }

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to delete.");
    return;
  }

  const tenantIds = tenants.map((t) => t.id);

  // Collect users that belong to (or have memberships in) these tenants —
  // they're test fixtures and should go too. We treat any user whose
  // primary `tenantId` is in the doomed set as a fixture user.
  const fixtureUsers = await prisma.user.findMany({
    where: { tenantId: { in: tenantIds } },
    select: { id: true, email: true },
  });
  const userIds = fixtureUsers.map((u) => u.id);
  console.log(`\nDeleting ${fixtureUsers.length} fixture user(s):`);
  for (const u of fixtureUsers) console.log(`  ${u.email}`);

  // Cascade in dependency order. Order mirrors the test teardown.
  const result = await prisma.$transaction(async (tx) => {
    const counts: Record<string, number> = {};
    counts.onboardingProgress = (await tx.onboardingProgress.deleteMany({ where: { tenantId: { in: tenantIds } } })).count;
    counts.userInvitation = (await tx.userInvitation.deleteMany({ where: { tenantId: { in: tenantIds } } })).count;
    counts.membership = (await tx.membership.deleteMany({ where: { tenantId: { in: tenantIds } } })).count;
    counts.auditEventByActor = (await tx.auditEvent.deleteMany({ where: { actorId: { in: userIds } } })).count;
    counts.auditEventByTenant = (await tx.auditEvent.deleteMany({ where: { tenantId: { in: tenantIds } } })).count;
    counts.userTenantNulled = (await tx.user.updateMany({ where: { tenantId: { in: tenantIds } }, data: { tenantId: null } })).count;
    counts.userDeleted = (await tx.user.deleteMany({ where: { id: { in: userIds } } })).count;
    counts.tenantDeleted = (await tx.tenant.deleteMany({ where: { id: { in: tenantIds } } })).count;
    return counts;
  });

  console.log("\nDeleted:");
  for (const [k, v] of Object.entries(result)) console.log(`  ${k.padEnd(22)} ${v}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
