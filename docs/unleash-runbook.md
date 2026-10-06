# Unleash Runbook — Feature-Flag Control Plane

Everything ye need to operate the platform feature flags: bringing Unleash up,
where each flag lives, authoring targeting, flipping kill-switches, rotating
tokens, backups, and what happens when Unleash is down.

Context: `#feature-management`. Design + cutover rationale in
[DECISIONS.md](../DECISIONS.md) (2026-06-20 entries). Plan-of-record (now shipped)
in [parked-plans/feature-management.md](../parked-plans/feature-management.md).

---

## Architecture at a glance

```
PostgreSQL (one engine, two databases) ───────────────────────────────────────
  bookingplatform   the app DB — incl. FeatureFlag rows (categories 1 + 2)
  unleash           Unleash's OWN DB — flag config, strategies, tokens, users

Unleash server  ── unleashorg/unleash-server:6, port 4242
  Admin UI          http://localhost:4242  (platform-admin authors flags here)
  Client/Admin API  http://localhost:4242/api/   (SDK + ops scripts)
  /health           liveness (used by the docker healthcheck)

Next.js app (src/)
  src/lib/flags/unleash.ts   lazy SDK singleton; polls every 15s; fail-static
  src/lib/flags/context.ts   builds targeting Context from the session
  src/lib/features.ts        ROUTER: Postgres vs Unleash per flag category
  The SDK evaluates flags LOCALLY from an in-memory copy + on-disk fs-cache.
  Unleash is a CONTROL PLANE — never a per-request network call.

CLI scripts
  npm run unleash:up      bring Postgres + Unleash up (docker compose)
  npm run unleash:logs    tail the Unleash container
  npm run flags:migrate   reproduce Postgres enablement as Unleash strategies
  npm run flags:parity    prove Postgres truth == live SDK eval (18/18)
```

The blast radius is small **by design**: the app reads flags from an in-memory
copy, so Unleash being down never blocks a request (see
[Resilience](#resilience--when-unleash-is-down)).

---

## The flag taxonomy — who owns what

Three categories, one router predicate (`src/lib/flags/keys.ts`). **This is the
first thing to know before touching any flag** — editing the wrong store has no
effect.

| Category | Owner (source of truth) | Flags | Where to change it |
|---|---|---|---|
| 1. Tenant-togglable | **Postgres** | `messaging`, `events`, `publicEvents`, `publicAvailability` | Tenant admin self-serves in-app; or `/api/admin/tenants/[id]/flags` |
| 2. Capability / preset | **Postgres** | `bookings`, `agent`, `funding`, `charity`, `liveStreaming`, `analytics` | Onboarding / plan-tier provisioning writes these |
| 3. Platform rollout | **Unleash** | `eventsShareExternal`, `eventsShowExternal`, `publicContent`, `weather`, `federation`, `helpOverrides`, `businessInsights`, `noShowPrediction`, `modelOps` | **The Unleash Admin UI** |

Only category 3 lives in Unleash. The router sends a key to Unleash **iff** it is
a platform flag AND Unleash is configured; otherwise it reads Postgres. So if the
env is unset, *everything* falls back to Postgres with no behaviour change.

---

## Operator day-to-day

### Bring Unleash up (local dev)

```bash
npm run unleash:up        # docker compose up -d postgres unleash
npm run unleash:logs      # tail until "Unleash has started"
```

The `unleash-db-init` one-shot creates the separate `unleash` database before the
server boots (it waits on `pg_isready`, then `CREATE DATABASE unleash` if absent).
The server runs its own migrations on first boot. Health: `curl http://localhost:4242/health`.

Log into the Admin UI at <http://localhost:4242> with Unleash's seeded admin
(`admin` / `unleash4all` unless changed). **Change this on any shared instance.**

Project = `default`, environment = `development`. Custom context fields
`tenantId`, `role`, and `groups` are already registered (the migration registers
them — strategies can't constrain on an unregistered field).

### Author / change a flag

Platform flags are edited in the Admin UI, never in code or Postgres. Each flag
has a `default` strategy whose **constraints** express the targeting. Changes
propagate to the running app within the SDK poll interval — **up to ~15 seconds**
(`refreshInterval: 15_000` in `src/lib/flags/unleash.ts`).

### Targeting recipes (verified 2026-06-20)

The context the app emits is built in `src/lib/flags/context.ts`: `userId`
(effective, omitted under impersonation), `role` (the 5-cohort enum), `tenantId`,
and `groups` (space-delimited `grp:<cuid>` tokens for custom permission groups).
`realRole` / `realUserId` are deliberately **not** emitted — never target on them.

| Goal | Recipe | Notes |
|---|---|---|
| Specific tenants | constraint `tenantId IN (<id>, …)` | What the Phase 2 migration writes; parity-proven |
| Role cohort | constraint `role IN (TENANT_ADMIN, …)` | `role` is the `Role` enum exactly |
| Dogfood to staff | constraint `role IN (PLATFORM_ADMIN)` | Same mechanism as above |
| Allow/deny a user | built-in `userWithId` strategy, or `userId IN/NOT_IN` | `userId` absent under impersonation by design |
| Percentage rollout | built-in `flexibleRollout` | Stickiness `userId` (per-user) or custom `tenantId` (whole-club) |
| Custom permission group | constraint `groups STR_CONTAINS grp:<cuid>` | **See the safety note below** |

**Group-targeting safety**: `groups` is a single space-delimited string of
`grp:<cuid>` tokens, and `STR_CONTAINS` is a substring match. This is collision-safe
**only because `Group.id` is a fixed-length cuid** (25 chars), so no token can be a
substring of another. A spike (2026-06-20) proved 7/7 membership/collision cases,
including that a non-member never false-matches. **If group ids ever move to a
variable-length scheme, this recipe must be revisited** (fallback = a small custom
strategy that splits on the delimiter). See [DECISIONS.md](../DECISIONS.md) 2026-06-20.

### Kill-switch (disable a flag fast)

In the Admin UI, toggle the flag **off in the `development` environment** (the
environment toggle, not just archiving the flag). The running app picks it up at
the next poll — **within ~15 seconds**, no deploy. Re-enable the same way.

Because the SDK fails *static* (serves last-known state when it can't reach the
server), a kill-switch only works while Unleash is reachable. For a true emergency
where Unleash itself is the problem, see Resilience below — category-3 flags fail
**closed** (OFF) once the cache expires, which is the safe direction.

---

## Tokens

Two distinct token types — do not mix them up:

| Token | Env var | Used by | Format | Scope |
|---|---|---|---|---|
| Backend (client) | `UNLEASH_API_TOKEN` | the **running app** (SDK) | `<project>:<env>.<hash>` | read-only flag eval |
| Personal access (PAT) | `UNLEASH_ADMIN_TOKEN` | **ops scripts** (Admin API) | `<user>:<hash>` | full Admin API |

The app only ever needs the **client** token. The migrate/parity scripts (and any
Admin-API automation) need the **PAT** — an `admin`-type token lacks the root role
the default session grants, so a PAT is the reliable choice.

### Rotating the client token

1. Admin UI → **API access** → create a new backend token for `default:development`.
2. Update `UNLEASH_API_TOKEN` in the deployment env.
3. Restart the Next.js app (the SDK reads the token once at construction).
4. Revoke the old token in the UI.

### Rotating the PAT

Admin UI → profile → **Personal API tokens** → create new, update
`UNLEASH_ADMIN_TOKEN` wherever scripts run, revoke the old. No app restart needed
(the running app doesn't use the PAT).

---

## Migration + parity scripts

Reproduce or re-verify the Postgres → Unleash cutover. Both need `UNLEASH_URL`
plus `UNLEASH_ADMIN_TOKEN` in `.env`.

```bash
npm run flags:migrate                  # DRY RUN — prints the plan, writes nothing
npm run flags:migrate -- --apply       # write category-3 strategies to Unleash
npm run flags:parity                   # assert Postgres truth == live SDK eval
```

- **Migrate** registers the `tenantId`/`role`/`groups` context fields, then for
  each platform flag writes a `default` strategy constrained `tenantId IN (<enabled
  tenants>)`. It is **idempotent** (clears + rewrites the env's strategies each run)
  and **never mutates Postgres rows** — so cutover stays reversible.
- **Parity** compares, for every (tenant × platform-flag), the Postgres row against
  a live SDK evaluation using the exact router context, plus a synthetic
  negative-control tenant. Exit 0 = full parity (last run 18/18).

---

## Resilience — when Unleash is down

The SDK evaluates locally and writes a fail-static backup to the OS tmpdir, so:

| Scenario | Behaviour |
|---|---|
| Unleash down, app already running | **Zero impact** — in-memory copy serves last-known flags |
| App cold-restarts while Unleash down, cache present | SDK reads last-known config from the on-disk fs-cache |
| App cold-restarts, **no** cache (first-ever boot, Unleash down) | Category-3 flags default **OFF** (fail-closed) |
| Unleash unconfigured (env unset) | Router reads **Postgres** for every flag — pre-cutover behaviour |
| Categories 1 + 2 (Postgres-owned) | Always work — independent of Unleash |
| Booking core (auth, bookings, availability) | Not flag-gated — unaffected regardless |

The on-disk cache lives in the OS temp directory; a fresh container with an empty
tmpdir is the only "no cache" case, and it fails **closed** (safe).

---

## Backups

Unleash shares the Postgres **server** but owns a separate `unleash` **database**.
All flag config, strategies, tokens, and users live in `unleash`; the app's data
lives in `bookingplatform`.

- A server-wide dump (`pg_dumpall`) or a volume snapshot of the `pgdata` volume
  captures **both** databases — one backup covers everything.
- If you back up per-database, **dump `unleash` too**, not just `bookingplatform`,
  or you'll lose all flag configuration on restore.

There is no separate Unleash state to back up beyond its database.

---

## Reversing the cutover

The cutover is reversible with no data surgery because the migration never touched
Postgres rows:

1. Unset `UNLEASH_URL` and `UNLEASH_API_TOKEN` in the app env.
2. Restart the app.

The router now reads **every** flag from Postgres, including the category-3 rows
that were left in place precisely for this. (A later optional cleanup migration may
retire those rows once the cutover is trusted — deferred deliberately.)

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Flag change in UI not reflected in app | Wait up to ~15s (poll interval). Confirm you toggled the **`development` environment**, not just the flag's global state. |
| All platform flags read OFF after deploy | Unleash unconfigured (env missing → Postgres fallback), **or** first-ever boot with Unleash unreachable and no fs-cache (fail-closed). Check `UNLEASH_URL`/`UNLEASH_API_TOKEN` and reachability. |
| Admin API returns 401/403 | Scripts need the **PAT** (`UNLEASH_ADMIN_TOKEN`), not the client token. An `admin`-type token lacks the root role — use a personal access token. |
| "Unknown context field" creating a constraint | The field isn't registered. `tenantId`/`role`/`groups` are registered by the migration; register others in the UI first. |
| Group targeting matches the wrong users | Check tokens are full `grp:<cuid>` (fixed-length). A truncated/partial token breaks the substring-collision guarantee — see the group-targeting safety note. |
| `unleash` container won't start | Check `unleash-db-init` completed (it creates the DB). `npm run unleash:logs`; ensure Postgres is healthy first. |

---

## When this thread fully ships

Phase 4 is the last phase of `#feature-management`. On completion: outcomes are in
[DECISIONS.md](../DECISIONS.md), `IN_FLIGHT.md` moves the entry Active → Recently
landed, and [parked-plans/feature-management.md](../parked-plans/feature-management.md)
is retired (this runbook is its operational successor).
