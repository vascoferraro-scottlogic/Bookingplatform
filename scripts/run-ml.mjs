/**
 * CLI runner for ML ModelOps operations — retrain or drift-check.
 * Mirrors the pattern of run-billing.mjs: POSTs to a protected app endpoint.
 *
 * Usage:
 *   node scripts/run-ml.mjs retrain
 *   node scripts/run-ml.mjs drift
 *
 * Env:
 *   AGENT_SECRET    — required, matches server-side AGENT_SECRET
 *   AGENT_BASE_URL  — defaults to http://localhost:3000
 */

const SECRET = process.env.AGENT_SECRET;
const BASE = process.env.AGENT_BASE_URL ?? "http://localhost:3000";

if (!SECRET) {
  console.error("AGENT_SECRET env var is required.");
  process.exit(1);
}

const command = process.argv[2];
if (!["retrain", "drift"].includes(command)) {
  console.error("Usage: node scripts/run-ml.mjs <retrain|drift>");
  process.exit(1);
}

async function main() {
  const endpoint = command === "retrain"
    ? `${BASE}/api/admin/model/retrain`
    : `${BASE}/api/admin/model/drift-check`;

  console.log(`ML ${command} → ${endpoint}`);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      // 422 from drift-check means not enough labelled samples — not a hard error
      if (res.status === 422 && command === "drift") {
        console.warn(`Drift check skipped: ${data.error ?? JSON.stringify(data)}`);
        process.exit(0);
      }
      console.error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
      process.exit(1);
    }

    if (command === "retrain") {
      console.log(`\nTraining complete`);
      console.log(`  Version : ${data.version}`);
      console.log(`  Outcome : ${data.outcome}`);
      if (data.metrics) {
        console.log(`  ROC-AUC : ${data.metrics.rocAuc?.toFixed(4) ?? "—"}`);
        console.log(`  F1      : ${data.metrics.f1?.toFixed(4) ?? "—"}`);
        console.log(`  Recall  : ${data.metrics.recall?.toFixed(4) ?? "—"}`);
      }
      if (data.champion) {
        console.log(`  Champion: ${data.champion.version} (ROC-AUC ${data.champion.rocAuc?.toFixed(4) ?? "—"})`);
      }
    } else {
      console.log(`\nDrift check complete`);
      console.log(`  Model   : ${data.modelVersion}`);
      console.log(`  Status  : ${data.status}`);
      console.log(`  Samples : ${data.sampleCount}`);
      console.log(`  ROC-AUC : ${data.rocAuc?.toFixed(4) ?? "—"} (Δ ${data.deltaRocAuc?.toFixed(4) ?? "—"})`);
      console.log(`  ECE     : ${data.calibrationError?.toFixed(4) ?? "—"}`);
    }
  } catch (e) {
    console.error("Request failed:", e.message);
    process.exit(1);
  }
}

main();
