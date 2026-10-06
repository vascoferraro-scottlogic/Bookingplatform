/**
 * CLI runner for agents — POSTs to the local /api/agent/run endpoint using
 * AGENT_SECRET. Used by npm scripts (`agent:detect`, `agent:triage`,
 * `agent:all`) and by external cron jobs.
 *
 * Usage:
 *   node scripts/run-agent.mjs <slug|all> [--tenant <tenantSlug|tenantId>] [--all-tenants]
 *
 * Env:
 *   AGENT_SECRET    — required, matches server-side secret
 *   AGENT_BASE_URL  — defaults to http://localhost:3000
 *   DATABASE_URL    — required when using --all-tenants (script reads tenant list)
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const SECRET = process.env.AGENT_SECRET;
const BASE = process.env.AGENT_BASE_URL ?? "http://localhost:3000";

if (!SECRET) {
  console.error("AGENT_SECRET env var is required.");
  process.exit(1);
}

const args = process.argv.slice(2);
const slugArg = args[0] ?? "all";
const tenantIdx = args.indexOf("--tenant");
const tenantArg = tenantIdx >= 0 ? args[tenantIdx + 1] : undefined;
const allTenants = args.includes("--all-tenants");

async function main() {
  const tenantIds = await resolveTenants();
  if (tenantIds.length === 0) {
    console.error("No tenants matched. Pass --tenant <slug|id>, or enable the 'agent' feature flag and use --all-tenants.");
    process.exit(1);
  }
  for (const t of tenantIds) {
    console.log(`\n=== Tenant: ${t.label} ===`);
    const url = `${BASE}/api/agent/run?tenantId=${encodeURIComponent(t.id)}`;
    const body = slugArg === "all" ? {} : { agentSlug: slugArg };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error(`  HTTP ${res.status}: ${JSON.stringify(data)}`);
        continue;
      }
      for (const r of data.runs ?? []) {
        console.log(`  [${r.agent}] ${r.status}${r.summary ? ` — ${JSON.stringify(r.summary)}` : ""}`);
        if (r.error) console.error(`  [${r.agent}] error: ${r.error}`);
      }
    } catch (e) {
      console.error(`  fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

async function resolveTenants() {
  if (tenantArg) {
    const t = await lookupTenant(tenantArg);
    return t ? [t] : [];
  }
  // --all-tenants OR default: query DB for tenants with agent flag enabled
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required when no --tenant provided.");
    process.exit(1);
  }
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  try {
    const tenants = await prisma.tenant.findMany({
      where: allTenants ? {} : { featureFlags: { some: { key: "agent", enabled: true } } },
      select: { id: true, slug: true, name: true },
    });
    return tenants.map(t => ({ id: t.id, label: `${t.name} (${t.slug})` }));
  } finally {
    await prisma.$disconnect();
  }
}

async function lookupTenant(arg) {
  if (!process.env.DATABASE_URL) {
    // Without DB access, assume the arg is a tenant id and pass it through.
    return { id: arg, label: arg };
  }
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  try {
    const bySlug = await prisma.tenant.findUnique({ where: { slug: arg }, select: { id: true, slug: true, name: true } });
    if (bySlug) return { id: bySlug.id, label: `${bySlug.name} (${bySlug.slug})` };
    const byId = await prisma.tenant.findUnique({ where: { id: arg }, select: { id: true, slug: true, name: true } });
    return byId ? { id: byId.id, label: `${byId.name} (${byId.slug})` } : null;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
