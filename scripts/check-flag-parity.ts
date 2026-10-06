// Parity check for the #feature-management Postgres → Unleash cutover.
//
// For every (tenant × platform-flag) it compares:
//   - Postgres ground truth: the FeatureFlag row (absent row = off), and
//   - Unleash evaluation via the SDK, using the EXACT context the router emits
//     (src/lib/features.ts isFeatureEnabled): { userId: `tenant:<id>`,
//     properties: { tenantId } }.
//
// A synthetic tenant id (present nowhere) is added as a negative control to prove
// the "tenant not in the IN-list → off" path, not just the all-on case.
//
// The SDK client uses InMemStorageProvider so it always fetches live state from
// the server (no stale on-disk fs-cache), and startUnleash() resolves only once
// the client has synchronised — so the comparison runs against fresh data.
//
// Exit 0 if every pair matches; 1 (with a mismatch list) otherwise.
//
// Usage:
//   npx tsx scripts/check-flag-parity.ts

import "dotenv/config";
import { startUnleash, InMemStorageProvider, type Unleash } from "unleash-client";
import { prisma } from "../src/lib/prisma";
import { PLATFORM_FLAGS } from "../src/lib/flags/keys";

const SYNTHETIC_TENANT = "synthetic-tenant-present-nowhere";

function evalUnleash(unleash: Unleash, tenantId: string, key: string): boolean {
  // Mirror the router's isFeatureEnabled(tenantId, key) context exactly.
  return unleash.isEnabled(key, { userId: `tenant:${tenantId}`, properties: { tenantId } });
}

async function main(): Promise<void> {
  const url = process.env.UNLEASH_URL;
  const token = process.env.UNLEASH_API_TOKEN;
  if (!url || !token) {
    console.error("UNLEASH_URL and UNLEASH_API_TOKEN must be set (the app's client token).");
    process.exit(1);
  }

  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });
  const rows = await prisma.featureFlag.findMany({
    where: { key: { in: [...PLATFORM_FLAGS] } },
    select: { tenantId: true, key: true, enabled: true },
  });
  const pgState = new Map<string, boolean>();
  for (const r of rows) pgState.set(`${r.tenantId}::${r.key}`, r.enabled);
  const postgresValue = (tenantId: string, key: string): boolean =>
    pgState.get(`${tenantId}::${key}`) ?? false;

  const unleash = await startUnleash({
    url,
    appName: process.env.UNLEASH_APP_NAME ?? "bookingplatform",
    customHeaders: { Authorization: token },
    refreshInterval: 1000,
    disableMetrics: true,
    storageProvider: new InMemStorageProvider(),
  });

  const subjects = [
    ...tenants.map((t) => ({ id: t.id, label: t.slug ?? t.id })),
    { id: SYNTHETIC_TENANT, label: "(synthetic negative control)" },
  ];

  let total = 0;
  let matches = 0;
  const mismatches: string[] = [];

  for (const subject of subjects) {
    for (const key of PLATFORM_FLAGS) {
      const pg = postgresValue(subject.id, key);
      const ul = evalUnleash(unleash, subject.id, key);
      total++;
      if (pg === ul) matches++;
      else mismatches.push(`tenant=${subject.label} flag=${key} postgres=${pg} unleash=${ul}`);
    }
  }

  console.log(
    `Parity: ${matches}/${total} match — ${subjects.length} tenants ` +
      `(incl. 1 negative control) × ${PLATFORM_FLAGS.length} platform flags\n`,
  );
  if (mismatches.length) {
    console.log("MISMATCHES:");
    for (const m of mismatches) console.log(`  ✗ ${m}`);
  } else {
    console.log("✓ Unleash matches Postgres for every (tenant, platform-flag).");
  }

  unleash.destroy();
  await prisma.$disconnect();
  process.exit(mismatches.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
