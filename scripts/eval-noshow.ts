// Evaluate the BookingNoShowPrediction model against realised outcomes.
//
// For each BookingNoShowPrediction row the script infers the ground-truth
// label from the booking's terminal status:
//   - actualNoShow = true (explicitly set by admin)  → label 1
//   - booking.status = NO_SHOW (redundant safety net) → label 1
//   - booking.status = CONFIRMED, date < today        → label 0 (showed up)
//   - everything else                                 → skipped (outcome unknown)
//
// Metrics computed:
//   - positive class rate
//   - confusion matrix + precision / recall / F1 at EVAL_THRESHOLD
//   - ROC-AUC (trapezoidal)
//   - calibration: avg predicted probability vs actual rate per decile
//
// Usage:
//   npx tsx scripts/eval-noshow.ts
//   npx tsx scripts/eval-noshow.ts --tenant lakeview-bowls
//   npx tsx scripts/eval-noshow.ts --tenant lakeview-bowls --model noshow-v1

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

// Threshold must match the operational riskThreshold in NoShowRiskAgent
// (default 0.4) so the eval reflects what the live agent actually flags.
const EVAL_THRESHOLD = 0.4;

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    tenant: get("--tenant"),
    modelVersion: get("--model"),
  };
}

async function resolveTenantId(arg: string): Promise<string> {
  const bySlug = await prisma.tenant.findUnique({ where: { slug: arg }, select: { id: true } });
  if (bySlug) return bySlug.id;
  const byId = await prisma.tenant.findUnique({ where: { id: arg }, select: { id: true } });
  if (byId) return byId.id;
  console.error(`ERROR: tenant "${arg}" not found.`);
  process.exit(1);
}

/** Trapezoidal ROC-AUC. Expects rows sorted descending by probability. */
function rocAuc(labels: number[], probabilities: number[]): number {
  const paired = probabilities
    .map((p, i) => ({ p, y: labels[i] })
    )
    .sort((a, b) => b.p - a.p);

  const pos = labels.filter((y) => y === 1).length;
  const neg = labels.length - pos;
  if (pos === 0 || neg === 0) return NaN;

  let tp = 0;
  let fp = 0;
  let auc = 0;
  let prevTp = 0;
  let prevFp = 0;

  for (const { y } of paired) {
    if (y === 1) tp++;
    else fp++;
    // Trapezoidal increment
    const tpr = tp / pos;
    const fpr = fp / neg;
    const prevFpr = prevFp / neg;
    auc += (fpr - prevFpr) * ((tp / pos + prevTp / pos) / 2);
    prevTp = tp;
    prevFp = fp;
  }
  return auc;
}

function fmt(n: number, decimals = 3): string {
  if (isNaN(n)) return "n/a";
  return n.toFixed(decimals);
}

async function main() {
  const args = parseArgs();
  const today = new Date().toISOString().slice(0, 10);

  // Build filter
  const predWhere: Record<string, unknown> = {};
  if (args.tenant) {
    predWhere.tenantId = await resolveTenantId(args.tenant);
  }
  if (args.modelVersion) {
    predWhere.modelVersion = args.modelVersion;
  }

  const preds = await prisma.bookingNoShowPrediction.findMany({
    where: predWhere,
    include: {
      booking: { select: { status: true, date: true } },
    },
  });

  if (preds.length === 0) {
    console.log("No prediction rows found. Run the no-show agent first.");
    await prisma.$disconnect();
    return;
  }

  // ── Derive ground-truth labels ────────────────────────────────
  const labelled: { probability: number; label: number }[] = [];
  let skipped = 0;

  for (const p of preds) {
    const status = p.booking.status;
    const date = p.booking.date;

    let label: number | null = null;
    if (p.actualNoShow === true || status === "NO_SHOW") {
      label = 1;
    } else if (status === "CONFIRMED" && date < today) {
      label = 0; // booking date has passed and it was confirmed → showed up
    } else {
      skipped++;
      continue;
    }
    labelled.push({ probability: p.probability, label });
  }

  console.log(`\nBooking No-Show Model Evaluation`);
  console.log(`${"=".repeat(50)}`);
  console.log(`Predictions total  : ${preds.length}`);
  console.log(`Labelled (scored)  : ${labelled.length}`);
  console.log(`Skipped (pending)  : ${skipped}`);

  if (labelled.length === 0) {
    console.log("\nNo labelled outcomes yet — wait for bookings to pass their date.");
    await prisma.$disconnect();
    return;
  }

  const probabilities = labelled.map((r) => r.probability);
  const labels = labelled.map((r) => r.label);
  const positives = labels.filter((y) => y === 1).length;
  const negatives = labelled.length - positives;
  const positiveRate = positives / labelled.length;

  console.log(`\nActual no-show rate: ${fmt(positiveRate, 3)} (${positives}/${labelled.length})`);

  // ── Confusion matrix at EVAL_THRESHOLD ───────────────────────
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  for (let i = 0; i < labelled.length; i++) {
    const predicted = probabilities[i] >= EVAL_THRESHOLD ? 1 : 0;
    const actual = labels[i];
    if (predicted === 1 && actual === 1) tp++;
    else if (predicted === 1 && actual === 0) fp++;
    else if (predicted === 0 && actual === 0) tn++;
    else fn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  console.log(`\nClassification metrics (threshold=${EVAL_THRESHOLD})`);
  console.log(`  TP=${tp}  FP=${fp}  TN=${tn}  FN=${fn}`);
  console.log(`  Precision : ${fmt(precision)}`);
  console.log(`  Recall    : ${fmt(recall)}`);
  console.log(`  F1        : ${fmt(f1)}`);

  // ── ROC-AUC ──────────────────────────────────────────────────
  const auc = rocAuc(labels, probabilities);
  console.log(`\nROC-AUC   : ${fmt(auc)}`);

  // ── Calibration by probability decile ────────────────────────
  console.log(`\nCalibration (predicted vs actual rate by decile)`);
  console.log(`  Bucket          | Pred (avg)  | Actual      | Count`);
  console.log(`  ${"─".repeat(55)}`);

  const buckets = 10;
  for (let b = 0; b < buckets; b++) {
    const lo = b / buckets;
    const hi = (b + 1) / buckets;
    const inBucket = labelled.filter(
      (r) => r.probability >= lo && (b === buckets - 1 ? r.probability <= hi : r.probability < hi),
    );
    if (inBucket.length === 0) continue;
    const avgPred = inBucket.reduce((s, r) => s + r.probability, 0) / inBucket.length;
    const actualRate = inBucket.filter((r) => r.label === 1).length / inBucket.length;
    const lo2 = (lo * 100).toFixed(0).padStart(3);
    const hi2 = (hi * 100).toFixed(0).padStart(3);
    console.log(
      `  ${lo2}% – ${hi2}%        | ${fmt(avgPred)}       | ${fmt(actualRate)}       | ${inBucket.length}`,
    );
  }

  // ── Model version breakdown ───────────────────────────────────
  const versions = [...new Set(preds.map((p) => p.modelVersion))];
  if (versions.length > 1) {
    console.log(`\nModel versions in this dataset: ${versions.join(", ")}`);
    console.log(`  (pass --model <version> to restrict to a single version)`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
