// Migrate PLATFORM (category-3) feature flags from Postgres into Unleash.
//
// For each platform flag this script reproduces the current per-tenant Postgres
// enablement as a single Unleash strategy constrained to the enabled tenants:
//
//   feature `<flag>`  enabled in <env>  with  default strategy + (tenantId IN [...])
//
// The router in src/lib/features.ts evaluates platform flags with context
// `{ properties: { tenantId } }`, so a `tenantId IN [...]` constraint gates the
// flag to exactly the tenants that had it on in Postgres. Tenants not in the list
// (including tenants created later) evaluate OFF — matching Postgres semantics
// where an absent row means off.
//
// ONLY category-3 (PLATFORM_FLAGS) are migrated. Tenant-togglable and
// capability/preset flags stay Postgres-owned (see src/lib/flags/keys.ts and
// DECISIONS.md 2026-06-20). This script never touches the Postgres rows — cutover
// is reversible by unsetting UNLEASH_URL/UNLEASH_API_TOKEN.
//
// Idempotent: re-running converges to the same Unleash state (it clears and
// rewrites the environment's strategies each run).
//
// Usage:
//   npx tsx scripts/migrate-flags-to-unleash.ts                 # dry run (default)
//   npx tsx scripts/migrate-flags-to-unleash.ts --apply         # write to Unleash
//   npx tsx scripts/migrate-flags-to-unleash.ts --apply --environment production
//
// Requires UNLEASH_URL and UNLEASH_ADMIN_TOKEN in the environment (.env).

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { PLATFORM_FLAGS } from "../src/lib/flags/keys";

type Json = Record<string, unknown>;

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const argValue = (flag: string, fallback: string): string => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PROJECT = argValue("--project", process.env.UNLEASH_PROJECT ?? "default");
const ENVIRONMENT = argValue("--environment", process.env.UNLEASH_ENVIRONMENT ?? "development");

const rawUrl = process.env.UNLEASH_URL;
const adminToken = process.env.UNLEASH_ADMIN_TOKEN;

if (!rawUrl || !adminToken) {
  console.error(
    "UNLEASH_URL and UNLEASH_ADMIN_TOKEN must both be set (see .env). " +
      "UNLEASH_ADMIN_TOKEN needs admin-API write access (an admin token or a PAT).",
  );
  process.exit(1);
}

// UNLEASH_URL is the client API base (…/api/). The admin API lives at …/api/admin.
const ADMIN_BASE = `${rawUrl.replace(/\/+$/, "")}/admin`;
const AUTH: string = adminToken;

interface ApiResult {
  status: number;
  // Parsed JSON body, or the raw text when not JSON, or null when empty.
  json: unknown;
}

async function api(method: string, path: string, body?: Json): Promise<ApiResult> {
  const res = await fetch(`${ADMIN_BASE}${path}`, {
    method,
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, json };
}

/** Link + enable the target environment for the project (no-op if already linked). */
async function ensureEnvironmentOnProject(): Promise<void> {
  if (!APPLY) return;
  await api("POST", `/projects/${PROJECT}/environments`, { environment: ENVIRONMENT });
}

// Custom context fields the app emits via buildContext (src/lib/flags/context.ts).
// Unleash only allows constraints on registered context fields, so these must
// exist before any strategy can target them — both for this migration (tenantId)
// and for Phase 3 UI targeting (role cohorts, custom groups).
const CONTEXT_FIELDS: ReadonlyArray<{ name: string; description: string }> = [
  { name: "tenantId", description: "BookingPlatform tenant id (cuid). Target a flag to specific tenants." },
  {
    name: "role",
    description:
      "Effective role of the requester: GUEST, USER, MAINTENANCE, TENANT_ADMIN, PLATFORM_ADMIN.",
  },
  {
    name: "groups",
    description: "Space-delimited custom permission-group tokens (grp:<id>) the user belongs to.",
  },
];

/** Register a custom context field if it does not already exist. */
async function ensureContextField(name: string, description: string): Promise<string> {
  const got = await api("GET", `/context/${name}`);
  if (got.status === 200) return "exists";
  if (got.status !== 404) {
    throw new Error(`Unexpected ${got.status} checking context field '${name}': ${JSON.stringify(got.json)}`);
  }
  if (!APPLY) return "would-create";
  const created = await api("POST", `/context`, { name, description });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(`Create context field '${name}' failed ${created.status}: ${JSON.stringify(created.json)}`);
  }
  return "created";
}

/** Create the feature toggle if it does not already exist. */
async function ensureFeature(name: string, description: string): Promise<string> {
  const got = await api("GET", `/projects/${PROJECT}/features/${name}`);
  if (got.status === 200) return "exists";
  if (got.status !== 404) {
    throw new Error(`Unexpected ${got.status} checking feature '${name}': ${JSON.stringify(got.json)}`);
  }
  if (!APPLY) return "would-create";
  const created = await api("POST", `/projects/${PROJECT}/features`, {
    name,
    type: "release",
    description,
    impressionData: false,
  });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(`Create feature '${name}' failed ${created.status}: ${JSON.stringify(created.json)}`);
  }
  return "created";
}

/** Remove all strategies on the env so the rewrite is deterministic. Returns prior count. */
async function clearStrategies(name: string): Promise<number> {
  const list = await api("GET", `/projects/${PROJECT}/features/${name}/environments/${ENVIRONMENT}/strategies`);
  const strategies = Array.isArray(list.json) ? (list.json as Array<{ id: string }>) : [];
  if (!APPLY) return strategies.length;
  for (const s of strategies) {
    await api("DELETE", `/projects/${PROJECT}/features/${name}/environments/${ENVIRONMENT}/strategies/${s.id}`);
  }
  return strategies.length;
}

/** Add a default strategy gated to the given tenants. */
async function addTenantStrategy(name: string, tenantIds: string[]): Promise<void> {
  if (!APPLY) return;
  const res = await api(
    "POST",
    `/projects/${PROJECT}/features/${name}/environments/${ENVIRONMENT}/strategies`,
    {
      name: "default",
      parameters: {},
      constraints: [
        {
          contextName: "tenantId",
          operator: "IN",
          values: tenantIds,
          inverted: false,
          caseInsensitive: false,
        },
      ],
    },
  );
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Add strategy to '${name}' failed ${res.status}: ${JSON.stringify(res.json)}`);
  }
}

/** Enable or disable the feature in the target environment. */
async function setEnabled(name: string, on: boolean): Promise<void> {
  if (!APPLY) return;
  const res = await api(
    "POST",
    `/projects/${PROJECT}/features/${name}/environments/${ENVIRONMENT}/${on ? "on" : "off"}`,
  );
  if (res.status !== 200 && res.status !== 204) {
    throw new Error(`${on ? "Enable" : "Disable"} '${name}' failed ${res.status}: ${JSON.stringify(res.json)}`);
  }
}

async function main(): Promise<void> {
  console.log(
    `Unleash flag migration — project=${PROJECT} env=${ENVIRONMENT} ` +
      `mode=${APPLY ? "APPLY" : "DRY-RUN"}`,
  );
  console.log(`Admin base: ${ADMIN_BASE}`);
  console.log(`Platform flags (${PLATFORM_FLAGS.length}): ${PLATFORM_FLAGS.join(", ")}\n`);

  await ensureEnvironmentOnProject();

  for (const field of CONTEXT_FIELDS) {
    const state = await ensureContextField(field.name, field.description);
    console.log(`  context-field ${field.name.padEnd(10)} ${state}`);
  }
  console.log("");

  for (const key of PLATFORM_FLAGS) {
    const rows = await prisma.featureFlag.findMany({
      where: { key, enabled: true },
      select: { tenantId: true },
    });
    const tenantIds = rows.map((r) => r.tenantId);

    const featureState = await ensureFeature(
      key,
      "Platform rollout flag migrated from Postgres (#feature-management).",
    );
    const cleared = await clearStrategies(key);

    if (tenantIds.length > 0) {
      await addTenantStrategy(key, tenantIds);
      await setEnabled(key, true);
    } else {
      await setEnabled(key, false);
    }

    const tenantSummary = tenantIds.length ? `[${tenantIds.join(", ")}]` : "(none → off)";
    console.log(
      `  ${key.padEnd(20)} feature=${featureState.padEnd(12)} ` +
        `enabledTenants=${tenantIds.length} ${tenantSummary} ` +
        `(cleared ${cleared} prior)`,
    );
  }

  await prisma.$disconnect();
  console.log(`\n${APPLY ? "Applied." : "Dry run complete — re-run with --apply to write to Unleash."}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
