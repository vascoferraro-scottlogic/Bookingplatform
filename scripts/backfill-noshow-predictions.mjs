/**
 * scripts/backfill-noshow-predictions.mjs
 *
 * Dev/QE helper: backfills BookingNoShowPrediction rows for synthetic labelled
 * bookings so the drift-check endpoint has labelled data to work with.
 *
 * In production, predictions are written by NoShowRiskAgent nightly and
 * outcomes are filled in as bookings settle to NO_SHOW or CONFIRMED.
 * This script is ONLY for local development and QE demo environments.
 *
 * Usage:
 *   node --env-file=.env scripts/backfill-noshow-predictions.mjs
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const p = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const model = await p.mlModelVersion.findFirst({ where: { status: "ACTIVE" } });
  if (!model) {
    console.error("No ACTIVE model version. Run: curl -X POST http://localhost:8001/train");
    process.exit(1);
  }
  console.log(`Active model: ${model.version}`);

  const bookings = await p.booking.findMany({
    where: {
      status: { in: ["CONFIRMED", "NO_SHOW"] },
      overrideReason: "synthetic:noshow-history",
    },
    select: { id: true, tenantId: true, status: true },
  });
  console.log(`Bookings to backfill: ${bookings.length}`);

  if (bookings.length === 0) {
    console.log("Nothing to backfill. Run: npx tsx scripts/seed-noshow-history.ts --tenant <slug>");
    process.exit(0);
  }

  let inserted = 0;
  for (const b of bookings) {
    // Use a rough probability proxy: real predictions would come from the agent.
    // These are intentionally noisy so the drift check gets non-trivial data.
    const probability = 0.15 + Math.random() * 0.5;
    const actualNoShow = b.status === "NO_SHOW";
    await p.bookingNoShowPrediction.upsert({
      where: { bookingId_modelVersion: { bookingId: b.id, modelVersion: model.version } },
      create: { bookingId: b.id, tenantId: b.tenantId, modelVersion: model.version, probability, actualNoShow },
      update: { actualNoShow },
    });
    inserted++;
  }

  console.log(`Done — inserted/updated ${inserted} prediction rows.`);
  console.log(`Run drift check: curl -X POST http://localhost:8001/drift`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
