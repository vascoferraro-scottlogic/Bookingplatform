# Parked plan: Feature Management via self-hosted Unleash (`#feature-management`)

**Status**: shipped 2026-06-20 — all phases (0–4) complete. See `DECISIONS.md`
2026-06-20 (4 entries) and the operational successor `docs/unleash-runbook.md`. This
file is kept (not deleted) for its pivot narrative + three-way-taxonomy derivation,
which have standalone reference value (parked-plans/README.md sanctions keep-with-
shipped-header).

**Status as of 2026-06-20**: shipped. Design agreed 2026-06-19 (Plan mode);
implemented 2026-06-20 across Phases 0–4 — infra + server SDK seam (no behaviour
change), live Unleash, the 9 category-3 platform flags migrated + cut over (parity
18/18), nav + homepage router-aware, admin route reconciled, targeting recipes
verified (group STR_CONTAINS spike 7/7), and the ops runbook landed. Test suite kept
hermetic. Cutover reversible by unsetting the env.

## Why here

Originated as a Plan-mode session that could not write committed files; the agreed
plan lived as a repo-memory bridge copy until promoted here. Mirrors the
`#permission-groups` precedent (design-then-implement). Kept in `parked-plans/`
as the refined plan-of-record while Phases 2–4 are staged.

## The pivot that shaped this (read first)

`#modular-services` shipped the **same day** the original plan was written
(`DECISIONS.md` 2026-06-19) and changed the flag landscape. The original plan
assumed a **binary** split (4 tenant-togglable flags in Postgres, everything else
to Unleash). That is wrong: `#modular-services` introduced a **capability-preset
layer** — onboarding writes `bookings`/`agent`/`funding`/`charity` to Postgres per
vertical ([src/app/api/onboarding/organisation/route.ts](../src/app/api/onboarding/organisation/route.ts) ~L150),
and plan tiers write `liveStreaming`/`analytics` bundles. "Flags remain the source
of truth." So several non-togglable flags are **per-tenant provisioning state**,
not platform rollout knobs. Routing those to Unleash for reads while onboarding
still writes them to Postgres would silently drop a tenant's capability bundle.

**Resolution → three-way taxonomy** (Q1 → A, 2026-06-20):

1. **Tenant-togglable → Postgres** (tenant self-serve): `messaging`, `events`,
   `publicEvents`, `publicAvailability`. (`TENANT_TOGGLABLE_FLAGS`, admin route L14.)
2. **Capability/preset → Postgres** (onboarding/plan-tier written, per-tenant
   provisioning): `bookings`, `agent`, `funding`, `charity` (+ tier-gated
   `liveStreaming`, `analytics`). **Stay in Postgres.**
3. **Platform rollout → Unleash**: `eventsShareExternal`, `eventsShowExternal`,
   `publicContent`, `weather`, `federation`, `helpOverrides`, `businessInsights`,
   `noShowPrediction`, `modelOps`.

Router predicate = "key ∈ Postgres-owned set (1 ∪ 2)?" → Postgres; else → Unleash.
Migration (Phase 2) touches **category 3 only**. `src/lib/flags/keys.ts` is the
**frozen shared taxonomy** that the Active `#billing` thread consumes rather than
redefining (Q2 → A).

## Decisions carried (confirmed 2026-06-19)

- **Tool = self-host Unleash** (`unleashorg/unleash-server`, Postgres-native).
  Pivoted from GrowthBook (hard MongoDB dependency, no fail-static) and Flagsmith
  (remote-eval default).
- **Deploy = long-running Node server** → rely on the SDK's on-disk fs-cache for
  fail-static; no bootstrap-from-Postgres mirror needed for v1.
- **5 role cohorts = the `Role` enum exactly** (GUEST/USER/MAINTENANCE/TENANT_ADMIN/
  PLATFORM_ADMIN), targeted via the `role` context field, NOT permission groups.
- **Custom-group targeting = a separate additive axis** by stable `grp:<cuid>`
  token (tenants rename/delete groups, so name is unsafe).
- **Unleash DB = separate `unleash` database** on the same Postgres server.
- **Management plane = platform-admin only, via the Unleash UI.** Tenant-admins keep
  self-serving the togglable subset in Postgres.
- **User-scoped impersonation = separate later thread `#impersonation-user-scope`**;
  expose an `effectiveUserId` seam now so it slots in with no rework.

## Resilience / blast radius

Flag tool = control plane, not in the request path. Next.js evaluates LOCALLY from
an in-memory copy; no per-request network call.
- Unleash down, app running → zero impact (in-memory cache serves).
- App cold-restarts while Unleash down → SDK reads last-known config from the
  on-disk fs-cache backup.
- No cache → category-3 flags default OFF (fail-CLOSED).
- Categories 1 + 2 read Postgres → keep working regardless.
- Booking core (auth, bookings, availability) is not flag-gated → unaffected.

## Impersonation gap

Impersonation is TENANT+ROLE scoped, NOT user scoped (`Impersonation` model =
`{ platformUserId, tenantId, assumedRole }`, `schema.prisma` L488; start route
hardcodes `assumedRole: "TENANT_ADMIN"`). Per-user phased rollout for REAL users
works regardless (each buckets on their own `userId`). Previewing one specific
user's exact state = the gap → `#impersonation-user-scope`. Do NOT emit `realRole`
into targeting (audit only).

## What shipped (this session, 2026-06-20)

- Phase 0: `unleash` service in `docker-compose.yml` (same Postgres, separate
  `unleash` DB, port 4242, `CHECK_VERSION=false`); env scaffolding in `.env.example`;
  `unleash:*` npm scripts.
- Phase 1: `unleash-client` dependency; `src/lib/flags/{keys,unleash,context}.ts`;
  `isFeatureEnabled` rewritten as a Postgres/Unleash router with a Postgres
  fallback when Unleash is unconfigured (zero behaviour change pre-cutover); new
  `flagIsOn(key, session, req)` for per-user/rollout targeting; unit tests via SDK
  bootstrap fixtures + mocked Postgres path.
- Phase 2: live Unleash up via `docker-compose` (db-init fixed to use the `postgres`
  maintenance DB — `psql -U booking` was crash-looping on a missing `booking` DB);
  `scripts/migrate-flags-to-unleash.ts` (registers `tenantId`/`role`/`groups`
  context fields, then per platform flag writes a `default` strategy constrained
  `tenantId IN (<enabled ids>)`, idempotent, `--apply` gated); cut reads over by
  configuring Unleash env; `scripts/check-flag-parity.ts` proved 18/18 parity
  (Postgres truth vs live SDK eval + a negative-control tenant); `jest.setup.env.cjs`
  clears `UNLEASH_*` so the suite always exercises the Postgres fallback (matches CI).
  Admin-API automation uses a PAT (admin-type tokens need a root perm the default
  session lacks). Migration never mutates Postgres rows → cutover reversible by
  unsetting the env.

Cross-ref `DECISIONS.md` 2026-06-20 (design entry + Phase 2 cutover entry).

## What's left (refined plan)

### Phase 2 — Migration + cutover (M) — category-3 flags only — DONE 2026-06-20
- ✅ `scripts/migrate-flags-to-unleash.ts`: registers `tenantId`/`role`/`groups`
  context fields (Admin API rejects constraints on unregistered fields), then per
  PLATFORM key creates the Unleash feature + a `default` strategy with constraint
  `tenantId IN (<enabled ids>)` reproducing current Postgres enablement. PAT auth;
  idempotent; `--apply` gated. Categories 1 + 2 NOT migrated.
- ✅ Cutover: Unleash env set so the router sends category-3 keys to Unleash.
  Parity proven by `scripts/check-flag-parity.ts` — 18/18 (every (tenant,
  platform-key) live SDK eval matches the old Postgres boolean) + negative control.
- Deferred: retiring category-3 rows in Postgres (optional cleanup migration) — left
  in place so cutover stays reversible by unsetting the env; revisit in Phase 4.

### Phase 3 — Targeting + management plane (M) — DONE 2026-06-20
- ✅ Nav gating routed through Unleash. `/api/features` (which `dashboard/layout.tsx`
  consumes) now overlays category-3 keys via the new `evaluatePlatformFlags(session,
  req, PLATFORM_FLAGS)` router helper — so `federation` / `businessInsights` nav links
  reflect Unleash targeting post-cutover instead of stale Postgres rows. Helper builds
  the Unleash context ONCE (avoids a per-key group-membership re-query) and keeps the
  Postgres fallback when Unleash is unconfigured. 4 new router tests.
- ✅ Admin flags API `/api/admin/tenants/[id]/flags` reconciled: imports the canonical
  `TENANT_TOGGLABLE_FLAGS` from `keys.ts` (was a divergent local Set) and the stale
  "`agent` is mandatory" comment is fixed (agent is vertical-conditional category-2
  since #modular-services). Behaviour already correct (non-togglable keys → 403);
  this removes the drift + corrects the rationale.
- DECISION: federation API routes (`/api/federations/**`) keep `isFeatureEnabled(tid,
  key)` (tenant-level), NOT `flagIsOn`. Federation is a whole-tenant capability — you
  don't roll it out to one admin but not another in the same club — so tenant-level
  eval with `tenant:<id>` stickiness is the correct semantics. They already route
  through Unleash correctly. `flagIsOn` is for surfaces where the *viewer* is the
  targeting subject (the nav), not tenant-scoped gates.
- ✅ `src/app/page.tsx` homepage public-club listing is router-aware (2026-06-20).
  Was a direct SQL `featureFlag` subquery mixing all three public flags; now fetches
  active tenants with their Postgres-owned flags (`publicEvents`/`publicAvailability`
  — tenant-togglable, authoritative in Postgres) and SDK-evals `publicContent`
  (PLATFORM/Unleash) per tenant via `isFeatureEnabled`. Smoke: live homepage renders
  200 with Browse Clubs present. Accepted tradeoff: in the Unleash-unconfigured
  fallback this is N per-tenant Postgres reads instead of one `some` filter — fine
  for the public directory's small active-tenant bound.
- ✅ Unleash UI targeting recipes verified (2026-06-20). Each is a `default` strategy
  with a constraint (or a built-in strategy); platform-admin authors them in the UI:
  - **Tenant lists** → constraint `tenantId IN (<ids>)`. Proven end-to-end — the whole
    Phase 2 migration writes exactly this and parity is 18/18.
  - **Role cohorts** → constraint `role IN (TENANT_ADMIN, …)`; dogfooding = `role IN
    (PLATFORM_ADMIN)`. Mechanically identical to `tenantId IN` (same operator, the
    `role` context field is registered), so it inherits the same proof.
  - **User allow/deny** → built-in `userWithId` strategy, or constraint `userId
    IN/NOT_IN`. Standard Unleash; `buildContext` emits `userId` (omitted under
    impersonation by design).
  - **Percentage** → built-in `flexibleRollout`, stickiness `userId` (per-user) or
    custom `tenantId` (whole-club bucketing). Standard.
  - **Custom permission groups** → constraint `groups STR_CONTAINS grp:<cuid>`.
    **SPIKE DONE — 7/7 against live Unleash** (throwaway script, run then deleted, not
    committed): full-token membership matches at any position in the space-delimited
    list; a non-member (`grp:<OTHER>` only) correctly evaluates false — **no
    cross-token substring collision**. This is safe *because* `Group.id` is
    `@default(cuid())` = fixed 25-char, so no token can be a substring of another. The
    spike's truncated-prefix control case *did* false-positive (a 12-char prefix
    matched the full token), proving the safety rests on fixed-length ids — **if we
    ever switch group ids to a variable-length scheme, STR_CONTAINS membership must be
    revisited** (fallback = a small custom strategy splitting on the delimiter). No
    fallback needed for v1. Cross-ref `DECISIONS.md` 2026-06-20.

### Phase 4 — Ops, docs, ledger (S) — DONE 2026-06-20
- ✅ Runbook `docs/unleash-runbook.md`: flag taxonomy (which store owns which flag),
  bring-up, verified targeting recipes, ~15s-poll kill-switch, client-token-vs-PAT
  split + rotation, migrate/parity scripts, fail-static behaviour, shared-server/
  separate-DB backup note, cutover reversal, troubleshooting.
- ✅ `UNLEASH_ADMIN_TOKEN` documented in `.env.example` (ops scripts need it; the app
  does not).
- ✅ Ledgers: `DECISIONS.md` Phase 4 entry; `IN_FLIGHT.md` Active → Recently landed;
  `ROADMAP.md` Now item struck; this file marked shipped (kept for reference value).
- Deferred (unchanged): optional cleanup migration retiring the shadowed category-3
  Postgres rows — left in place so cutover stays reversible.

### Reconcile while here
- ✅ The admin flags route comment that called `agent` "mandatory/locked" is fixed
  (2026-06-20) — agent is vertical-conditional (category 2) since #modular-services;
  the route now imports the canonical `TENANT_TOGGLABLE_FLAGS` so it can't drift.
- ✅ `publicContent` / `weather` re-confirmed category-3 (2026-06-20): no onboarding
  or plan-tier writer provisions them, so routing their reads to Unleash is safe.
  Both migrated in Phase 2.
- ✅ `src/app/page.tsx` migrated off the direct `FeatureFlag` query for `publicContent`
  (2026-06-20) — now routes through `isFeatureEnabled` so it sees Unleash post-cutover;
  the tenant-togglable `publicEvents`/`publicAvailability` reads stay on Postgres.

## Relevant files

- `docker-compose.yml` — `unleash` service (reuse Postgres, separate DB), port 4242.
- `package.json` — `unleash-client` dep; `unleash:*` scripts.
- `src/lib/features.ts` — `isFeatureEnabled` → Postgres/Unleash router; keep
  `setFeatureFlag`/`getTenantFlags`; new `flagIsOn`.
- `src/lib/flags/unleash.ts` (new) — SDK singleton, fs-cache fail-static, config gate.
- `src/lib/flags/keys.ts` (new) — typed keys + 3-way taxonomy (the frozen contract).
- `src/lib/flags/context.ts` (new) — `buildContext`: effective role, `effectiveUserId`
  seam, custom-group lookup.
- `src/lib/roles.ts` — `getEffectiveRole` is the seam; NOT edited here.
- `src/app/api/admin/tenants/[id]/flags/route.ts` — shrink to tenant-togglable (Ph 3).
- `src/app/api/onboarding/organisation/route.ts` — vertical preset writer; STAYS Postgres.
- `src/app/dashboard/layout.tsx` — nav gating (Phase 3).
- `scripts/migrate-flags-to-unleash.ts` (Phase 2, done) — registers context fields +
  writes `tenantId IN (...)` strategies; `--apply` gated, idempotent.
- `scripts/check-flag-parity.ts` (Phase 2, done) — Postgres-truth vs live-SDK parity
  gate; run after any migration/cutover change.
- `jest.setup.env.cjs` (Phase 2) — clears `UNLEASH_*` so the suite stays on the
  Postgres fallback (hermetic, matches CI); wired via `setupFiles` in `jest.config.cjs`.
- `.env.example` — `UNLEASH_URL`, `UNLEASH_API_TOKEN`, `UNLEASH_APP_NAME`.

## Resume signals

- A session named `bp: #feature-management`.
- Any work touching `src/lib/features.ts` flag evaluation or `src/lib/flags/`.
- Standing up Unleash locally to start Phase 2 (migration + cutover).

## Cross-refs

- `DECISIONS.md` — 2026-06-20 (`#feature-management`), 2026-06-19 (`#modular-services`).
- `parked-plans/permission-groups.md` — related RBAC thread (the 3 built-in groups).
- `parked-plans/billing.md` — consumes the `keys.ts` taxonomy (Q2 → A).
- `/memories/repo/architecture.md` — multi-tenant / roles / flags snapshot.
- Related future thread: `#impersonation-user-scope` (user-scoped impersonation).
