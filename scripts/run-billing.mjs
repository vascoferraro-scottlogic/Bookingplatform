/**
 * CLI runner for billing generation — POSTs to the local
 * /api/admin/billing/generate endpoint using AGENT_SECRET.
 *
 * Usage:
 *   node scripts/run-billing.mjs [--tenant <tenantId>] [--dry-run] [--trigger-webhook]
 *
 * Env:
 *   AGENT_SECRET    — required, matches server-side secret
 *   AGENT_BASE_URL  — defaults to http://localhost:3000
 */

const SECRET = process.env.AGENT_SECRET;
const BASE = process.env.AGENT_BASE_URL ?? "http://localhost:3000";

if (!SECRET) {
  console.error("AGENT_SECRET env var is required.");
  process.exit(1);
}

const args = process.argv.slice(2);
const tenantIdx = args.indexOf("--tenant");
const tenantId = tenantIdx >= 0 ? args[tenantIdx + 1] : undefined;
const dryRun = args.includes("--dry-run");
const triggerWebhook = args.includes("--trigger-webhook");
const STUB_SECRET = process.env.PAYMENT_STUB_SECRET ?? "";

async function main() {
  const url = `${BASE}/api/admin/billing/generate`;
  const body = {};
  if (tenantId) body.tenantId = tenantId;
  if (dryRun) body.dryRun = true;

  console.log(`Billing generation ${dryRun ? "(DRY RUN) " : ""}→ ${url}`);
  if (tenantId) console.log(`  Tenant: ${tenantId}`);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
      process.exit(1);
    }

    console.log(`\nGenerated: ${data.generated} invoice(s)`);
    if (data.dryRun) console.log("  (dry run — no records created)");
    for (const r of data.results ?? []) {
      console.log(`  • Tenant ${r.tenantId}: £${(r.amount / 100).toFixed(2)} (${r.lineItems.length} line items)`);
    }
    // Optionally trigger simulated webhooks for each created invoice (dev convenience)
    if (triggerWebhook && !dryRun) {
      for (const r of data.results ?? []) {
        const webhookUrl = `${BASE}/api/payments/webhook`;
        const body = { type: "payment_succeeded", paymentId: r.paymentId, providerId: r.paymentId };
        try {
          const headers = { "Content-Type": "application/json" };
          if (STUB_SECRET) headers.Authorization = `Bearer ${STUB_SECRET}`;
          const wr = await fetch(webhookUrl, { method: "POST", headers, body: JSON.stringify(body) });
          const wdata = await wr.text().catch(() => "");
          if (wr.ok) {
            console.log(`  → Triggered webhook for ${r.paymentId}`);
          } else {
            console.error(`  → Webhook HTTP ${wr.status}: ${wdata}`);
          }
        } catch (e) {
          console.error(`  → Webhook request failed for ${r.paymentId}: ${e.message}`);
        }
        // small pause to avoid bursts
        await new Promise((res) => setTimeout(res, 150));
      }
    }
  } catch (err) {
    console.error("Request failed:", err.message);
    process.exit(1);
  }
}

main();
