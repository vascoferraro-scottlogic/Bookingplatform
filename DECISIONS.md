# Decisions Log — BookingPlatform


## 2026-10-06 — AWS training deployment architecture (`#hosting-cloud`)

**Status**: DECIDED — AWS deployment uses ECS Fargate + RDS.

**Decision**: For the AWS training deployment, use one ECS Fargate app task and
one Single-AZ RDS PostgreSQL database. Do not use the EC2 + Docker Compose
alternative. Keep the deployment minimal and rely on an existing approved
network and user-access path; any new ingress or supporting services require
a separate scope and estimate.

**Scope**: This records the selected architecture within AWS. It does not
resolve the separate choice between AWS and the previously documented Oracle
cloud option. Requirements and cost assumptions are in
`aws-hosting-requirements.md`; deployment steps are in `docs/hosting-aws.md`.

## 2026-06-26 — Cross-platform container tooling + free runtime for the tester lab (`#hosting`)

**Status**: SHIPPED 2026-06-26 (tooling + workshop doc + GHCR pull path);
compose profiles / Codespaces fallback considered but deferred.

**Context**: Reframe from the 2026-06-21 entry: the blue/green stack isn't a
passive demo to *watch* — it's a hands-on rig where **each tester runs the
containers themselves** to practise managing deploys and feature toggles on
container infra. Two blockers surfaced when handing it over: (a) **Docker
Desktop isn't free** for the org (its licence is paid above 250 staff / $10M
revenue), and (b) the `stack:*` npm scripts used a **Bash-only idiom**
(`APP_VERSION=$(git …) docker compose …`) and `swap` was a **Bash script** —
both fail on Windows `cmd`/PowerShell, and the team is Windows-heavy (the
existing workshop doc is Windows-first).

**Decision / outcome**:

1. **Sanctioned free runtime = Rancher Desktop with the `dockerd (moby)`
   backend.** It provides real `docker` + `docker compose`, so our tooling runs
   verbatim, plus a GUI for watching containers/logs while learning, on
   Windows/macOS/Linux. **Podman Desktop** documented as the free alternative
   (set `COMPOSE_CMD="podman compose"`). **OrbStack and Docker Desktop excluded**
   — both are paid for commercial use.
2. **Tooling made shell-agnostic.** Rewrote the compose lifecycle and the
   colour swap as Node (`bin/stack.mjs`, `bin/swap.mjs`) — Node is already a
   prerequisite, so no Git Bash/WSL needed on Windows. Dropped the Bash-only
   `APP_VERSION` inline (compose already defaults it; the wrapper still stamps
   the git SHA cross-platform). Container engine is overridable everywhere via
   a single `COMPOSE_CMD` env var. Deleted `bin/swap.sh`.
3. **Standalone "Blue/Green Infrastructure Lab" track** added to
   `docs/WORKSHOP-SETUP.md` — separate from the bare-Node Project Phoenix
   exercise. Covers runtime install, `npm run stack:up`, a blue/green deploy
   via `npm run swap` (watch `/api/health`), a feature-flag flip in Unleash,
   and data-safe teardown (`pgdata` persists across `down`/`up`).
4. **GHCR pull path for prebuilt images.** A GitHub Action
   (`.github/workflows/build-images.yml`) builds all three images
   (`bookingplatform-app`/`-migrate`/`-ml`) **multi-arch (amd64 + arm64)** — one
   tag set covers Apple Silicon Macs and amd64 Windows/Linux — and pushes them
   to GHCR (manual `workflow_dispatch` or a `v*` tag). A compose overlay
   (`docker-compose.ghcr.yml`, layered by `npm run stack:pull` /
   `stack:up:ghcr` through a new `--ghcr` flag on `bin/stack.mjs`) swaps the
   locally-built images for the published ones, so testers **download instead
   of running the multi-minute Next build**. The baseline ML model
   (`ml/artifacts/noshow-v1.joblib`) is now force-tracked (gitignore negation)
   so CI and clean clones bake a complete sidecar.

**Rationale**: Each tester needs an isolated, resettable stack they can break
and rebuild — that *is* the exercise — so "hand them one URL" was the wrong
model. Rancher/moby was chosen over Podman to keep zero tooling churn (no
`docker`→`podman` alias friction); both are free-for-commercial, but moby is
verbatim-compatible. Keeping the toolchain `docker compose`-shaped (rather than
forking to podman-native) means the skills transfer to the eventual cloud
target (`#hosting-cloud`). The Node rewrite removes the only hard Windows
barrier while preserving the exact same `npm run` entry points.

**Notes**: Of the earlier deferrals, **GHCR prebuilt images are now shipped**
(point 4). Still deferred: compose `profiles` for a "lite" lab (skip the ML
sidecar) and a `.devcontainer` + Codespaces fallback for locked-down machines.
GHCR packages must be made **public** after the first publish so testers pull
without authenticating (documented in the workflow + workshop doc). Multi-arch
arm64 layers build under QEMU emulation in CI (slow but unattended; a native
arm64-runner matrix is the future speed-up). Verified: the GHCR overlay merges
and resolves to the four `ghcr.io/...` refs with `build:` dropped via `!reset`
(so the pull path never silently rebuilds), the base compose still builds from
source, and `bin/stack.mjs` passes `node --check`. Earlier tooling checks (swap
flips blue↔green with a graceful reload; `/api/health` tracks colour) unchanged.
Cross-references the 2026-06-21 `#hosting` entry.

## 2026-06-21 — Zero-cost blue/green hosting + observability (`#hosting`)

**Status**: local stack + observability (Phases 0/1/4) SHIPPED & verified 2026-06-21; cloud (Phase 2) + cron/backups (Phase 3) deferred.

**Context**: Need to deploy and run the app at genuinely zero cost, tolerate
cold starts, never lose data once in real use, and offer a blue/green
demo/training surface for the test team — ideally the same topology locally.
A Plan-mode session (2026-06-21) researched free-tier hosting + observability.

**Decision / outcome**:

1. **One topology, local and cloud**: a Docker Compose stack with two app
   colours (`app-blue` + `app-green`) sharing one Postgres + Unleash + ML
   sidecar, fronted by a **Caddy** reverse proxy. Blue/green is a Caddy
   upstream swap (`bin/swap.sh`) — zero-downtime; SSE clients auto-reconnect.
2. **Shared database per topology** (not one DB per colour) — simpler, and
   the no-data-loss guarantee comes from `prisma migrate deploy` + an
   expand/contract migration discipline rather than DB-per-colour isolation.
3. **Cloud = Oracle Always-Free ARM VM + Coolify** (deferred): the same
   compose runs 24/7 free; Coolify gives a managed feel (push-to-deploy,
   auto-TLS, R2 backups) without a paid PaaS. Data on **Neon** (durable,
   off-box) so no-data-loss never hinges on a single VM volume. Render+Neon
   kept as a documented zero-management fallback at reduced cloud fidelity.
4. **Observability = Better Stack** via the `@logtail/next` client, wired
   once and shared by both colours. Inert without a source token (same
   optional-SDK pattern as Unleash). Server-side `onRequestError` owns
   attribution: every event tagged `deployment.color` + `release` (the git
   SHA already computed in `next.config.ts`) + tenant/role → a bad phased
   rollout is attributable to colour × release × flag cohort. Uptime
   monitors hit a new public `/api/health` per colour; heartbeats wrap the
   cron jobs and the nightly backup (paged if backups silently stop).
5. **Backups = nightly `pg_dump` → Cloudflare R2** (deferred to Phase 3).

**Rationale**: The constraints form a trilemma — full-fidelity, zero-cost,
zero-server-management: pick two. Oracle VM buys full-fidelity-always-on at
zero cash but costs management; managed PaaS (Render) is zero-management but
its 750-hr/month cap + spin-down can't run four always-on services, cutting
fidelity; a managed always-on box costs ~$5–10/mo. Coolify on the Oracle VM
plus treating the box as disposable cattle (Neon off-box, Cloudflare Tunnel
= no inbound ports, unattended-upgrades, Better Stack paging) shrinks the
residual management to "occasional patch + paged if down" — the best fit for
the stated wants. Self-hosting observability was rejected: extra containers
blow the budget, and observing yourself from the same box blinds you on an
outage (deferred; if ever done, on its own box).

**Notes**: Phase 0 hardening (git-SHA-tolerant build + `output: 'standalone'`,
app Dockerfile, public `/api/health`, `migrate deploy` + conditional first-boot
seed) is the shared prerequisite. Render free Postgres ruled out (expires 30
days, no backups); Fly.io ruled out (free allowances discontinued for new
orgs). Full plan in the `bp: #hosting` session notes.

**Landed (2026-06-21) — local stack verified end-to-end**: all six services
healthy (postgres, app-blue, app-green, caddy, ml-noshow, unleash); blue/green
swap works both ways via `bin/swap.sh` (`caddy reload`, zero-downtime), with
`/api/health` flipping `color` blue↔green and carrying `release` (git SHA);
structured observability boot log lands on stdout (`{level,message:"app
boot",color,release,node}`), Better Stack inert without a token; full NextAuth
credentials login works over plain `http://localhost:8090` (cookies
`HttpOnly; SameSite=Lax`, NOT `Secure` — derived from the `http://`
`NEXTAUTH_URL`), returning the seeded `PLATFORM_ADMIN`. Implementation
refinements made while standing it up:

- **Demo entry port is 8090, not 8080** — 8080 was held by an unrelated
  process; Caddy maps `8090:80` and `NEXTAUTH_URL` matches.
- **Host-sensitive URLs are hardcoded in compose** for the dockerised colours
  (`NEXTAUTH_URL: http://localhost:8090`, `UNLEASH_URL: http://unleash:4242/api/`)
  rather than `${VAR:-default}`, so a dev's local `.env` (`localhost:3000` /
  `localhost:4242`) can't leak host-localhost values into the containers and
  break the auth callback / Unleash dialling. Secrets still inherit from `.env`.
- **Build hardening** (all in the Dockerfile): copy `.npmrc`
  (`legacy-peer-deps=true`) into the deps stage so `npm ci` resolves the
  `ts-jest`/`typescript` peer conflict; set a placeholder `DATABASE_URL` ENV in
  the builder so `prisma.config.ts`'s `env()` resolves during
  `prisma generate` / `next build`; drop the non-existent `public/` COPY; ml
  healthcheck uses stdlib `python urllib` (the python image has no `curl`).
- **Known follow-up (not blocking)**: ml `/health` reports
  `modelLoaded:false` — `serve.py`'s `_find_active_artifact()` prefers the DB
  registry path, which isn't baked into the image, and `load()` doesn't fall
  back to `ML_MODEL_PATH` when that path is absent on disk. Logged on the repo
  backlog.


## 2026-06-20 — Feature management via self-hosted Unleash (`#feature-management`)

**Status**: decided / shipped (all phases; see the Phase 2–4 entries below)

**Context**: The flag system is a per-tenant boolean table (`FeatureFlag`) read on
every call with no targeting, no phased rollout, and no central control plane. As
the platform took on multi-vertical provisioning (`#modular-services`) and a
subscription model (`#billing`), the need for platform-admin-driven targeting
(specific users, role cohorts, % rollout, whole tenants) outgrew a boolean column.
A Plan-mode session (2026-06-19) evaluated tooling and agreed a design; this
resumes it for implementation.

**Decision / outcome**:

1. **Self-host Unleash** (`unleashorg/unleash-server`, Postgres-native) as the flag
   control plane behind the existing `isFeatureEnabled` seam. Separate `unleash`
   database on the same Postgres server (one engine, one backup). The Node SDK
   evaluates flags LOCALLY from an in-memory copy + writes an on-disk fs-cache, so
   the flag tool is never in the request path and survives Unleash being down.

2. **Three-way flag taxonomy** (revised from the original binary split after
   `#modular-services` landed a capability-preset layer the same day):
   (1) tenant-togglable → Postgres (tenant self-serve);
   (2) capability/preset → Postgres (onboarding/plan-tier written, per-tenant
   provisioning: `bookings`/`agent`/`funding`/`charity` + tier `liveStreaming`/
   `analytics`);
   (3) platform rollout → Unleash. `isFeatureEnabled` becomes a router: keys in the
   Postgres-owned set (1 ∪ 2) read Postgres unchanged; platform keys read Unleash,
   with a Postgres fallback while Unleash is unconfigured (so Phase 1 is a
   zero-behaviour-change seam). Migration moves category 3 only.

3. **`src/lib/flags/keys.ts` is the frozen shared taxonomy** that `#billing`
   consumes rather than redefining (its plan tiers write flag bundles).

4. **Targeting**: 5 role cohorts = the `Role` enum exactly, via the `role` context
   field (not permission groups — guest and platform-admin don't fit the
   tenant-scoped group model). Custom permission groups = a separate additive axis
   by stable `grp:<cuid>` token. Management plane = platform-admin only, via the
   Unleash UI; tenant-admins keep self-serving the togglable subset in Postgres.

5. **`effectiveUserId` seam** in the context builder: session user id when not
   impersonating; omitted under today's tenant+role impersonation; the impersonated
   user's id once `#impersonation-user-scope` lands (zero rework). `realRole` is
   never emitted into targeting (audit only).

**Rationale**: Unleash is the only mainstream OSS flag tool that is Postgres-native
(no second datastore) with built-in local evaluation + fail-static — so it folds
into the existing one-Postgres operational story. The three-way taxonomy is forced
by `#modular-services`: provisioning flags are WRITTEN to Postgres by onboarding,
so routing their READS to Unleash would silently drop a tenant's capability bundle.
Keeping them Postgres-owned (Q1 → A) avoids rewriting onboarding/billing writers
against the Unleash Admin API for no user-facing gain.

**Rejected alternatives**:
- **GrowthBook**: hard MongoDB dependency, no Postgres option, no built-in
  fail-static — would add a second datastore purely for flags.
- **Flagsmith**: remote-evaluation by default, offline handlers still maturing —
  weaker fit for the in-request-path-free, fail-static requirement.
- **Move provisioning flags to Unleash too** (Q1 → B): rejected — requires
  rewriting the onboarding vertical preset + plan-tier provisioning to call the
  Unleash Admin API, with read/write divergence risk and no targeting benefit (these
  flags are per-tenant state, not rollout knobs).
- **Defer all migration / Unleash for new flags only** (Q1 → C): rejected — leaves
  the existing platform flags without the targeting the thread exists to deliver.
- **Permission-group targeting for cohorts**: rejected — guest (unauth, no
  membership) and platform-admin (cross-tenant) don't fit the tenant-scoped,
  opt-in group model; the `Role` enum maps the 5 cohorts cleanly.

**Notes**: Phase 0 (infra scaffolding) + Phase 1 (SDK seam, no behaviour change)
land 2026-06-20. Phases 2–4 (migration, cutover, targeting, management plane) need a
live Unleash with tokens — staged in `parked-plans/feature-management.md`.
User-scoped impersonation preview is a known gap → separate thread
`#impersonation-user-scope`.


## 2026-06-20 — Feature management Phase 2: live cutover of platform flags (`#feature-management`)

**Status**: decided / shipped (extends the design entry above)

**Context**: With the Phase 1 seam in place (router + Postgres fallback, no behaviour
change), Phase 2 stood up a live Unleash, moved the 9 category-3 platform flags into
it, and cut reads over — under the invariant that the cutover must be provably
behaviour-preserving and reversible.

**Decision / outcome**:

1. **Migration faithfully reproduces the Postgres truth table.** Each platform flag
   becomes one Unleash feature carrying a single `default` strategy constrained
   `tenantId IN [ids of tenants with FeatureFlag.enabled=true]`; a flag with no
   enabled tenants is left disabled. New tenants absent from the list evaluate OFF —
   matching Postgres absent-row = false. The migration never mutates Postgres rows, so
   cutover is reversible by unsetting `UNLEASH_URL`/`UNLEASH_API_TOKEN` (router falls
   back to Postgres). `scripts/migrate-flags-to-unleash.ts`, `--apply` gated, idempotent.

2. **Custom context fields `tenantId`/`role`/`groups` are registered as part of
   migration.** The Unleash Admin API rejects constraints that reference unregistered
   context fields, so they must exist before the `tenantId IN …` strategy can be
   written. Registering all three now also lays the Phase 3 targeting foundation (role
   cohorts, `grp:<cuid>` groups) at no extra cost.

3. **Admin-API automation authenticates via a Personal Access Token, not an
   admin-TYPE API token.** Minting an admin-type token needs a root ADMIN permission
   the default admin session lacks (403); a PAT (`POST /api/admin/user/tokens`)
   inherits the user's full admin rights and works. This is the documented ops path
   for the runbook; the client SDK uses a separate client token.

4. **Tests stay hermetic by clearing the Unleash env.** `jest.setup.env.cjs` (a
   `setupFiles` entry) deletes `UNLEASH_URL`/`UNLEASH_API_TOKEN`/`UNLEASH_ADMIN_TOKEN`
   before any test runs, so the suite always exercises the Postgres fallback
   regardless of a developer's live `.env` — matching CI (no Unleash) and keeping
   flag-routing tests deterministic. Without this, a configured `.env` silently routes
   platform-flag tests at live Unleash.

5. **Parity is the cutover acceptance gate.** `scripts/check-flag-parity.ts` compares
   Postgres ground truth against a live SDK evaluation for every (tenant × platform
   flag), plus a synthetic negative-control tenant, using an in-memory storage
   provider to force a fresh fetch. 18/18 matched at cutover.

**Rationale**: Reproducing the exact enablement set as an `IN` constraint (rather than
flipping each flag globally on/off) is what makes the cutover parity-checkable and
keeps per-tenant semantics identical across the seam. The env-clear is the cheapest way
to guarantee the test suite mirrors CI no matter what a developer has configured
locally.

**Notes**: `docker-compose` db-init fixed to connect to the `postgres` maintenance DB
(`-d postgres`) — `psql -U booking` was defaulting dbname to the username and crash-
looping Unleash on a missing database. Tokens live in the gitignored `.env`, not in the
repo. Remaining: `src/app/page.tsx:26` reads `FeatureFlag` directly and won't see
Unleash post-cutover — a Phase 3 migration item.


## 2026-06-20 — Feature management Phase 3: nav gating + router-aware homepage + targeting recipes (`#feature-management`)

**Status**: decided / shipped (extends the Phase 2 entry above)

**Context**: Post-cutover, anything still reading category-3 flags straight from
Postgres shows stale state. The dashboard nav was one such reader. Phase 3 also has to
decide *which* call sites want session-aware (per-user) targeting vs tenant-level
evaluation — they are not interchangeable.

**Decision / outcome**:

1. **Nav gating routes category-3 through Unleash.** `/api/features` (consumed by
   `dashboard/layout.tsx`) was returning raw Postgres rows, so `federation` /
   `businessInsights` nav links read stale Postgres post-cutover. It now overlays the
   platform keys via a new `evaluatePlatformFlags(session, req, keys)` router helper.

2. **`evaluatePlatformFlags` builds the Unleash context once** for many keys, rather
   than calling `flagIsOn` per key (which would rebuild context + re-query group
   membership each time). It mirrors `flagIsOn`'s Postgres fallback when Unleash is
   unconfigured, so it's behaviour-preserving pre-cutover.

3. **Session-aware (`flagIsOn` / `evaluatePlatformFlags`) is for surfaces where the
   *viewer* is the targeting subject; tenant-level (`isFeatureEnabled(tid,key)`) is for
   whole-tenant capability gates.** Concretely, the federation API routes
   (`/api/federations/**`) deliberately KEEP `isFeatureEnabled` — federation is a
   whole-club capability (you don't enable it for one admin but not another in the same
   tenant), so tenant-level eval with `tenant:<id>` stickiness is the correct semantics.
   The nav, by contrast, is the current user's own view, so it gets session context.

4. **Admin flags route de-duplicated against the taxonomy.** `/api/admin/tenants/[id]/
   flags` imported a local `TENANT_TOGGLABLE_FLAGS` Set that duplicated `keys.ts`; it now
   imports the canonical one so the gate can't drift, and the stale "`agent` is
   mandatory" comment is corrected (agent is vertical-conditional category-2 since
   `#modular-services`).

**Rationale**: The viewer-vs-tenant distinction is the load-bearing call here — blindly
threading `session` into every category-3 site (as "thread session into call sites"
could be read) would have mis-targeted tenant-scoped gates like federation. Evaluating
once per nav load (not once per flag) keeps the group-membership query from being
amplified ×9.

**Notes**: Closed out the two items left open earlier in the phase. (a) `src/app/
page.tsx` homepage was restructured from a direct SQL `featureFlag` subquery (which
mixed all three public flags) to fetching active tenants with their Postgres-owned
flags and SDK-evaluating `publicContent` per tenant via `isFeatureEnabled`; smoke =
live homepage 200 with Browse Clubs present. (b) The Unleash UI targeting recipes were
verified against the live instance — `tenantId IN` (already proven by the Phase 2
migration), `role IN` cohorts (same operator, registered field), `userWithId` allow/
deny, `flexibleRollout` %, and custom groups via `groups STR_CONTAINS grp:<cuid>`.

**Group-targeting spike conclusion (non-obvious, worth recording)**: a throwaway script
(run then deleted, not committed) created temp `STR_CONTAINS` features on live Unleash
and evaluated 7 membership/collision cases through the real SDK — all 7 as expected. The
load-bearing finding: `groups STR_CONTAINS grp:<cuid>` over a space-delimited token list
is collision-safe **only because `Group.id` is `@default(cuid())` = fixed 25-char**, so
no token can be a substring of another. The spike's control case proved the hazard is
real for the variable-length case (a deliberately truncated 12-char prefix false-matched
the full token). **Constraint for the future: do not switch group ids to a
variable-length scheme without revisiting this** — the fallback would be a small custom
strategy that splits on the delimiter. No fallback needed for v1. Only Phase 4 (runbook +
retire the parked-plan) remains.


## 2026-06-20 — Feature management Phase 4: ops runbook + thread complete (`#feature-management`)

**Status**: decided / shipped — closes `#feature-management`

**Context**: Phases 0–3 stood up Unleash, cut the 9 platform flags over, made the
read surfaces router-aware, and verified the targeting recipes. What remained was
purely operational: capturing how to run the thing so a future operator (or a cold
parallel session) isn't reverse-engineering it from `docker-compose.yml` and the SDK
config.

**Decision / outcome**:
- Added `docs/unleash-runbook.md` — the operational successor to the parked plan.
  Covers the flag taxonomy (which store owns which flag — the #1 way to waste an hour
  is editing the wrong one), bring-up, the verified targeting recipes, the ~15s-poll
  kill-switch, the client-token-vs-PAT split + rotation, the migrate/parity scripts,
  fail-static behaviour, the shared-server/separate-DB backup note, and reversing the
  cutover.
- Documented `UNLEASH_ADMIN_TOKEN` in `.env.example` — it was undocumented, yet the
  ops scripts need it (the running app does not). A new operator following the runbook
  would otherwise hit a missing-token error on `flags:migrate`.
- Retired `parked-plans/feature-management.md` by marking it **shipped** rather than
  deleting it: the pivot narrative (`#modular-services` reshaping the taxonomy) and the
  three-way-taxonomy derivation have standalone reference value the per-phase DECISIONS
  entries don't fully duplicate (parked-plans/README.md sanctions either).

**Rationale**: A runbook earns its keep only by capturing what the code and compose
file *can't* say — the taxonomy ownership rule, the fail-**closed** direction on a cold
cache, the two-token split, and the fixed-length-cuid dependency behind group
targeting. Those are the load-bearing operational facts; the rest is signposting to
scripts that already self-document.

**Notes**: No code/behaviour change this phase — docs + ledgers only. Deferred
(unchanged): the optional cleanup migration to retire the now-shadowed category-3
Postgres rows, left in place so the cutover stays reversible by unsetting the env.


## 2026-06-19 — Multi-vertical platform pivot: modular services for non-bowling orgs (`#modular-services`)

**Status**: decided / implementing

**Context**: Interest from UK-registered CIOs wanting charity governance + funding tools with no bowling facility. Separately, interest from golf and cricket clubs where the same groundskeeping / maintenance workflow applies but "greens" and "rinks" are wrong vocabulary. Led to a re-examination of what the platform's core is: bookings and maintenance are *generic capabilities over facilities*, not bowling-specific. The Vision ("for bowling clubs worldwide") was also too narrow.

**Decision / outcome**:

1. **Two-axis modularisation.** Axis A (now): make bookings and maintenance toggleable capabilities, like charity and funding already are. Add a `Vertical` enum (BOWLS, GOLF, CRICKET, MULTI_SPORT, CHARITY_ADMIN, OTHER) as a preset that seeds capability flags; flags remain the source of truth. Axis B (deferred): generalise domain vocabulary (Green → Facility, Rink → Resource) — ~1,100 LoC change, own tag `#facility-generalisation`, gated on golf/cricket needing real bookings.

2. **`bookings` feature flag** added as the missing off-switch for the booking capability. `agent` flag (maintenance) already existed but was mandatory; now conditional on vertical. CHARITY_ADMIN vertical turns both off and ensures `funding` is on.

3. **Dashboard nav gated on flags.** Bookings / Greens / Booking Admin behind `bookings`; Maintenance / Agents behind `agent`. Previously hardcoded for all tenants.

4. **Adaptive onboarding wizard.** Chapter 2 (Organisation) gains a vertical selector. Greens chapter (5) is automatically skipped when `bookings` is off; go-live blocker list excludes it dynamically. Knowledge chapter (6) adapts prompts for non-bowling verticals. Chapter 7 (Features) "agent — always on" display is conditional.

5. **Charity Admin `PlatformPlan` seeded** (£20/mo, maxGreens=0, featureFlags bundle: messaging+events+funding+charity). Plan card in onboarding hides the greens limit when maxGreens=0.

6. **Branding neutralised** on key shared surfaces: onboarding header + chapter titles say "organisation" not "club"; sidebar title updated; public page booking widgets gated on `bookings` flag.

**Rationale**: Golf/cricket clubs have the same maintenance workflow as bowls clubs — the same groundsman might maintain all three. Splitting "booking" off as a capability flag costs very little and cleanly unblocks pure-admin charities without touching the facility domain model. The 2-axis split defers the expensive vocabulary rework until there's a real vertical that needs it.

**Rejected alternatives**:
- Flags-only (no `vertical` enum): rejected — no clean place to hang per-vertical vocabulary defaults, harder to provision sensible defaults at approval.
- New `PlatformFee` model: rejected — `PlatformPlan` is already a dedicated fee model separate from streaming tiers and per-booking payments. Duplicating it would create divergence.
- Pulling facility generalisation forward: rejected — ~1,100 LoC (~65% structural), not needed for any immediately interested vertical.
- Hide booking nav when no greens exist: rejected — too implicit, fragile, confusing for admins mid-onboarding.

---

## 2026-06-17 — ML no-show prediction feature: area selection, architecture, and planted-bug strategy (`#ml-noshow`)

**Status**: shipped (Phases 0–4 complete)

**Context**: User requested a machine-learning exercise for training testers — a real ML feature with realistic planted bugs that QEs can discover. Needed to pick a domain, design the architecture, and ship the full feature (schema → Python sidecar → agent → eval → tests).

**Decision / outcome**:

1. **Domain chosen: no-show prediction for bookings.** Rationale: booking data (lead time, history, day-of-week, tenure) is a natural tabular classification target; a binary outcome (`NO_SHOW` vs attended) provides ground truth; the consequence (proactive reminder) is credible. Other candidates (midge risk, member churn) were rejected — midge risk is heuristic-not-ML, churn risk lacks a tight signal in early-stage data.

2. **Python FastAPI sidecar (`ml/`)** rather than a JS ML library. Rationale: gives trainees a realistic train/serve boundary and a real HTTP contract to test. scikit-learn (logistic regression) over TensorFlow/PyTorch — appropriate for tabular data, fast to train, interpretable. Sidecar runs on port 8001 via docker-compose.

3. **`usesLLM=NEVER` agent.** `NoShowRiskAgent` calls the Python sidecar, not the LLM. Rationale: keeps cost at zero, demonstrates the agent framework can integrate non-LLM predictions, and creates a different test surface than the existing detector/triager agents.

4. **Planted bug #15 (ACTIVE): `EVAL_THRESHOLD = 0.5` in `scripts/eval-noshow.ts`.** The operational agent uses `riskThreshold: 0.4` and `FEATURES.md` documents "≥40%". The eval script uses 0.5, causing artificially low recall. Discovery path: run `npm run eval:noshow` → notice low recall → compare against `NoShowRiskAgent` config → compare against `FEATURES.md` → find the mismatch in the eval script. Medium difficulty. Bugs #16–19 are potential follow-on plants (label leakage, train/serve skew, stale artifact, silent NaN bias).

5. **Loose version bounds in `ml/requirements.txt`** instead of strict pins. Python 3.14 (on dev machine) has cp314 binary wheels for pandas 3.x and scikit-learn 1.9+, but the pinned versions (pandas 2.3.1, scikit-learn 1.7.1) were too new to have cp314 wheels and too old to have them yet. Loose lower bounds let pip pick the right wheel for the host Python. Docker (3.12-slim) continues to resolve to older compatible versions.

6. **26 pytest + 8 jest integration tests.** Python tests cover feature engineering (17 tests) and FastAPI contract (10 tests). TS jest tests cover ml-client error handling, NoShowRiskAgent proposal emission, and the reminder committer — all against a real test DB with full teardown.

**Rationale**: Stub-first approach (no real email provider, seeded synthetic history) means the full pipeline is demonstrable without external dependencies. The sidecar pattern is realistic to what a production club SaaS might use. The planted threshold bug is discoverable through normal QE exploratory testing without requiring source code access.

**Rejected alternatives**:
- Pure JS ML (ONNX, brain.js) — rejected; Python/scikit-learn is the industry standard for tabular classification, more realistic test surface.
- Planting the bug in train.py or features.py — rejected; too low-level, hard to discover without running training. Eval script is the natural QE touch-point.
- Strict version pins in requirements.txt — rejected; broke on Python 3.14, loose bounds are appropriate for a training exercise (not a production lockfile).

---

## 2026-06-18 — ModelOps: end-to-end model lifecycle management (`#modelops`)

**Status**: shipped (all 7 phases complete)

**Context**: After `#ml-noshow` shipped (Phases 0–4), predictions were never persisted (root bug), and there was no lifecycle for training, promoting, or monitoring models. User requested "a whole lot of ModelOps missing" + a runbook for operator-driven feature control.

**Decision / outcome**:

1. **Persisted predictions in the agent.** Root fix: `NoShowRiskAgent` previously computed probabilities and emitted proposals but never wrote `BookingNoShowPrediction` rows. Fixed with an upsert after every successful `predictNoShow()` call. Added `@@unique([bookingId, modelVersion])` constraint.

2. **Feature registry (enroll / retire) rather than code-gated flags.** Operator enrolls/retires features via the platform dashboard. Compute is always in code (`ml/features.py`), enrollment is config (DB row). Train pipeline reads ENROLLED set dynamically and builds the `ColumnTransformer` from it. Rejected: branching compute on feature flags in Python — would require redeployment for every feature change.

3. **Champion/challenger gate (ROC_AUC_TOLERANCE = 0.02).** New model promoted only if its ROC-AUC ≥ champion − 0.02. Prevents silent regressions from new features with poor signal. Tolerance chosen as 2pp — meaningful in a booking-domain binary classifier; narrow enough to catch real regressions.

4. **Removed planted bug #15 (EVAL_THRESHOLD = 0.5).** Deliberate ML training-scenario bugs are deferred to a future phase. The existing planted bugs (threshold mismatch) were confusing the ModelOps implementation work — they obscured whether the eval script was correct. Bug #15 is now resolved; new training-scenario bugs, if any, will be planted explicitly and tracked separately.

5. **Write-authority split: train.py writes its own registry row; app layer handles promotion.** The Python sidecar is responsible for computing metrics, auto-bumping versions, and writing `MlModelVersion` rows. The TS app layer owns the champion/challenger gate and status transitions (TRAINED → ACTIVE/REJECTED). This keeps the Python side stateless w.r.t. business logic and lets the TS side audit and control promotions.

6. **Drift check is windowed (30-day rolling) against training baseline.** Computes ROC-AUC and ECE over `BookingNoShowPrediction` rows with known outcomes. WARN at Δ ROC-AUC < −0.05 or ECE > 0.15; DRIFT at −0.10 / 0.25. Thresholds are in `ml/drift.py` constants — no DB config. Rationale: keeping thresholds in code makes them reviewable via git diff; operator-configurable thresholds would require a separate UI.

7. **`docs/modelops-runbook.md`** — operator-facing runbook covering: adding a feature (8-step end-to-end), retiring a feature, train/serve skew guardrails, environment variables, and cron scheduling recommendations.

**Rejected alternatives**:
- Auto-enroll all computed features — rejected; operator should control what the model uses, especially when a new feature may carry data-quality risk at first.
- Rollback UI — deferred; too much surface area for Phase 7. Manual DB approach documented in the runbook.


## 2026-05-05 — Platform billing plan refined: stub-first, all-encompassing dashboards (`#billing`)

**Status**: decided (planned, not yet implemented)

**Context**: Phase 5 of the roadmap ("platform billing model") had a one-liner scope. Session reviewed the entire existing billing/payment infrastructure (TenantSubscription is streaming-only, TenantPayment has no period/type/line-items, no PlatformPlan, no billing profiles, no financial dashboards, no charting library). User asked for an all-encompassing plan covering subscription model + financial dashboards for both platform admin and tenant admin, keeping the stub payment engine (no real Stripe yet).

**Decision / outcome**:
1. **New schema models**: `PlatformPlan` (3 seed tiers: Starter £25, Standard £50, Premium £100 with escalating limits), `TenantBillingProfile` (per-tenant, links to plan + billing contact/address/VAT + lifecycle status), `InvoiceLineItem` (per-charge detail on TenantPayment). `TenantPayment` extended with `type` enum, `periodStart/End`, `billingProfileId`, `pdfUrl`.
2. **Stub-first billing**: invoices created as PENDING; platform admin manually marks PAID. Same pattern as outbound messaging. No Stripe integration.
3. **Admin-mediated plan changes**: tenants view plans but cannot self-serve switch. Avoids proration. CTA is "contact platform admin".
4. **recharts** chosen for charting (React-native, declarative, no SSR issues in dashboard pages).
5. **Platform Finance Dashboard** (`/dashboard/platform/finance`): MRR, ARR, ARPT, churn rate, revenue by plan tier, trend charts, outstanding invoices.
6. **Agent cost dashboard** (`/dashboard/platform/costs`): LLM spend per tenant, budget cap utilisation, model breakdown. Fields already exist on `AgentRun` + `TenantAgentBudget`.
7. **Tenant billing portal** (`/dashboard/billing`): plan card, billing profile form, invoice history with CSV export. Plan comparison at `/dashboard/billing/plans`.
8. **Onboarding upgrade**: subscription chapter becomes a plan picker; creates `TenantBillingProfile` with status=TRIAL. Defaults to Starter if skipped.
9. **CSV exports**: revenue report, all-invoices, tenant summary (platform); single invoice line items (tenant).
10. **Invoice generation via HTTP script**: `scripts/run-billing.mjs` mirrors `run-agent.mjs` pattern (cron-friendly).

**Rationale**:
- Stub-first means the full dashboard/reporting/invoice UX can be built and demonstrated without a payment provider. The same pattern worked for outbound messaging — build the whole feature, swap the provider later.
- Explicit line items (not just a flat amount) because future charges (streaming upsell, booking commission, ad revenue share, credits) need to be visible per-invoice. Adding them later would require backfilling or losing history.
- Admin-mediated plan changes are appropriate for a small-club SaaS at this stage. Self-serve with proration is a Stripe-phase concern where the provider handles the complexity.
- Agent cost dashboard is nearly free (data already captured) and gives platform admins cost awareness before budget enforcement UX arrives.

**Rejected alternatives**:
- Real Stripe integration now — rejected; blocks on account setup + KYC + sandbox wiring. Stub is coherent and demoable.
- Self-serve plan switching — rejected; proration logic without a billing provider is a quagmire (partial months, mid-cycle changes, refund calculation). Admin mediation is fine for <50 clubs.
- chart.js / d3 — rejected; recharts is more idiomatic for React/Next.js dashboards and avoids SSR canvas issues.
- Dashboards only (no new models) — rejected; without PlatformPlan there's nothing to visualise beyond the existing flat TenantPayment table.

**Notes**: Full implementation plan at `parked-plans/billing.md`. Six phases: A (schema) → B (API) → C (platform dashboards, parallel with D) → D (tenant portal) → E (onboarding) → F (exports). Open considerations: proration (deferred), PDF generation (deferred to Stripe), booking commission model (slot reserved in enum).


## 2026-05-05 — Agent v2: propose-not-publish loop closed end-to-end (`#agents-v2`)

**Status**: decided / shipped (Steps 3c-i, 3c-ii, 4 of the agent-v2 strategy plan)

**Context**: The v2 schema substrate landed 2026-05-03 (`AgentProposal` + scopes + costs — see entry of that date). The detector still wrote `MaintenanceTask` rows directly; nothing yet exercised `applyProposal`/`rejectProposal`; there was no review surface. Steps 3c-i (first per-kind committer), 3c-ii (detector migration), 3c-iii (topic clustering — already has its own entry), and Step 4 (inbox UI + review API) were sequenced to close the propose-not-publish loop end-to-end.

**Decision / outcome**:
1. **Committer pattern** (`src/lib/agent/committers/`): one file per `kind`, exporting a kind constant + an `apply(proposal, approver)` function. Side-effect import barrel (`register-all.ts`) wires committers into the registry; anything that calls `applyProposal` must import the barrel. This keeps the proposal substrate generic (kind is a free-text discriminator) while enforcing per-kind logic at apply-time.
2. **`MAINTENANCE_TASK_CREATE` committer is smart-merge, not blind insert.** At apply-time it looks for an open task in same tenant + same category + ≤30 days old + title token-overlap ≥0.4 Jaccard; on hit it appends an anonymised `TaskNote` ("[Agent] Cluster merged: N additional voices") and bumps priority via `clusterImpliedPriority`; on miss it creates a new `MAINTENANCE_ONLY`-visibility task. Final priority is `max(approver edits, payload, cluster-implied)`. Two-knob design: similarity at clustering time (0.35, body-similarity) and at committer time (0.4, title-overlap) are deliberately separate — clustering catches "people complaining about the same thing right now", committer-merge catches "we already have an open ticket for this".
3. **Detector v2 emits proposals only — no domain writes.** Pre-clusters via `clusterMessages()`, picks highest-confidence canonical per cluster, emits one `MAINTENANCE_TASK_CREATE` proposal per cluster with `participantCount`/`toneSeverity`/`sourceMessageIds` aggregated. One `AgentDecision` per cluster member referencing the same `proposalId` for provenance. `relatedExistingTaskId` LLM hint, manual `TaskNote`-on-merge, and 24h escalation count all removed — committer owns merge logic now.
4. **Inbox API + UI** (`/api/agent/proposals`, `/dashboard/agents/inbox`):
   - `GET` lists with `?status=`/`?kind=`/`?limit=` filters; tenant-scoped.
   - `POST .../[id]/approve` accepts optional `{ edits }`, calls `applyProposal`, audit `agent.proposal.approved` with kind + committed entity ref.
   - `POST .../[id]/reject` accepts `{ reason? }`, audit `agent.proposal.rejected`.
   - Auth: TENANT_ADMIN+MAINTENANCE on the proposal's tenant; PLATFORM_ADMIN cross-tenant; USER role 403; cross-tenant approve blocked at the API.
   - UI: Pending + Recent tabs; ProposalCard shows title/description/category/priority/participantCount/tone/confidence/agent-reasoning. Approve calls committer; Reject opens an inline reason form with placeholder copy nudging admins to be specific (the *reason* is the training-data signal).
   - Nav link gated to `isMaintenanceEffective`.
5. **Deferred from Step 4 (commit message): bulk approve-above-confidence, snooze, and approve-with-edits UI.** API supports `edits` already; UI sends empty edits for v1. Snooze and bulk are second-pass UX once real proposal volume reveals which one matters.
6. **`scripts/seed-fake-proposals.ts`**: dev helper that drops 5 varied PENDING proposals (low/med/high/urgent across 5 categories with different participant counts and tone severities) into a tenant. Re-runnable via `--clean`. Lets the inbox be exercised end-to-end without an LLM key. Approving/rejecting seeded proposals goes through the real committer + audit path.

**Rationale**:
- **Smart-merge in the committer, not the detector**, because the detector only sees the message stream; the committer sees task state at the moment of approval. This catches the "approver clicked yesterday's proposal today, by which point an open task already exists" case that detector-time merging would miss.
- **Anonymised merge note** (`[Agent] Cluster merged: N additional voices`) preserves the cluster-size signal without leaking author identity into a wider-audience artefact — consistent with the 2026-05-03 anonymisation policy entry.
- **Side-effect barrel** is the smallest pattern that ensures committers are wired without forcing the proposal substrate to know about specific kinds.
- **Three-knob priority** (approver edits → payload → cluster-implied, max wins) means the LLM proposal is a floor, not a ceiling: a critic admin can downgrade in `edits`, but the cluster signal can't be talked down by a low-confidence LLM call.
- **Auth model**: maintenance-on-tenant is the right grain because a TENANT_ADMIN with no maintenance scope shouldn't be approving facility tickets. PLATFORM_ADMIN bypass is for cross-tenant audit/spike work, not routine review.

**Rejected alternatives**:
- **Detector also calls the committer's match function** to label proposals as "would-merge" at proposal-time: tempting for inbox UX (admin sees "this will merge into task X"), but recreates the staleness problem propose-not-publish is designed to avoid. Defer to a future "committer dry-run preview" feature if admins ask for it.
- **Per-kind reject reason enums**: rejected. Free-text reject reasons are higher-signal training data (per the 2026-05-03 schema substrate decision §L.4); an enum closes that off.
- **Bulk approve / snooze / approve-with-edits UI in v1**: deferred. None of them are blockers for validating the loop; all of them are easier to design correctly after watching real admin behaviour.

**Notes**:
- Commits: 5128d30 (committer + barrel), a771cdc (detector migration), e42e898 (clustering — see separate entry), 9ad76a5 (Step 4), 82ac6a5 (build-time tsc fix on `maxPriority` accumulator type), ead755d (seed script), d1a78c4 (seed-script enum fix).
- Test count: 369 → 382 (net +13 inbox route tests; clustering + committer tests already in earlier commits).
- Lesson: `npm run build` (strict tsc) catches TS narrowing bugs that ts-jest accepts. Worth running before push, especially for new files. Logged in `/memories/repo/backlog.md` already.
- Follow-ups parked in `parked-plans/agent-v2-followups.md`: 3c-iv (agent self-supersede stale proposals — pull in before this UI gets production traffic) and 3c-v (triager migration to `MAINTENANCE_TASK_ASSIGN` proposals).


## 2026-05-05 — Federation & Permissions Revamp: full design plan

**Status**: decided (planned, not yet implemented)

**Context**: The TAR wizard, charity accounts, and future features need finer-grained access control than the 4-tier role enum. Simultaneously, the "federations" vision item (FEATURES.md one-liner) needed a concrete design. Both must be designed together because federation officers need cross-tenant permissions. Explored during planning session; no timeline pressure — goal was to get the architecture right.

**Decision / outcome**:
1. **Permission groups** — club-defined named groups (e.g. "Trustees", "Greenkeepers", "Funding Committee") with platform-defined permission grants (~35 permissions across all domains). Existing roles remain as tier scaffold; TENANT_ADMIN = implicit all permissions. Custom groups sit at USER tier. Built-in groups seeded per tenant mirror legacy roles.
2. **Federation v1 is flat** — peer agreement between clubs; no hierarchy. Clubs self-organise (any TENANT_ADMIN creates + invites). Player mobility: federation members book at partner clubs with configurable billing (FREE_ACCESS / REDUCED_RATE / HOST_CLUB_RATE).
3. **Platform guardrails** — 10 clubs/federation (configurable), 3 federations/club, 5 invites/day rate limit. Platform admin can suspend/dissolve. No booking quota. Self-service creation with platform notification.
4. **Cross-club booking clash warnings** — soft 409: same time slot at different club = `CROSS_CLUB_CLASH` ("did ye forget?"); adjacent slot at different club = `CROSS_CLUB_CONSECUTIVE` ("you'll need to travel"). Both are confirm-to-proceed, no hard block. Does NOT apply intra-club (multi-rink = intentional).
5. **`federation.book_at_partners` is grantable** — clubs control which members get federation booking rights via permission groups.
6. **Implementation phased**: C1 (permission schema), C2 (dual gate on routes), C3 (club UI for groups), C4 (federation schema + lifecycle), C5 (player mobility), C6 (federation UI).

**Rationale**: See full plan at `/memories/session/plan.md`. Key architectural choices: permissions-not-roles gives clubs flexibility to match their committee structure; flat federation matches real-world bowling club agreements; guardrails contain query fan-out (max 30 tenants in a user's federation set); soft warnings respect user autonomy while catching likely mistakes.

**Notes**: Full plan persisted at `/memories/session/plan.md`. Branch: `feature/permission-groups` (already named in earlier parked decision). No dependencies on in-flight features — can start on a worktree alongside current work.


## 2026-05-05 — Permission groups: club-defined, intersects with federations

**Status**: superseded-by-2026-05-05-full-design

**Context**: The TAR wizard (and future funding application generation, document management) needs finer-grained access control than the current USER / MAINTENANCE / TENANT_ADMIN role enum. A "trustee" who can finalise a TAR shouldn't necessarily manage events. A "committee member" might handle finances but not greenkeeping. The existing three-role enum forces TENANT_ADMIN as a catch-all.

**Decision / outcome**:
- Permission groups (club-defined named groups with platform-defined permission grants) — not flat per-member permissions, not role-based
- TENANT_ADMIN becomes "implicitly has all permissions" (backward compat); eventually the role enum becomes vestigial
- MAINTENANCE role equivalent to a group with maintenance.* permissions
- **Must be designed alongside federations** — a federation secretary needs permissions that span multiple tenants; the permission model needs a scope axis (tenant / federation / platform)
- Separate branch: `feature/permission-groups`

**Rationale**: Permissions-not-roles gives clubs the flexibility to match their actual committee structure without the platform prescribing org charts. Groups (not flat lists) because clubs think in terms of "the finance team" not "Bob has charity.view, charity.edit, charity.finalise_tar". Federation intersection is the key constraint — designing permissions without cross-club scoping would require a rework when federations land.

**Rejected alternatives**:
- Flat permission list per member: simpler but doesn't map to how clubs think ("who's on the events committee?")
- Replace TENANT_ADMIN entirely now: breaking change across all route guards — too risky mid-feature
- Implement in the TAR branch: scope too large, orthogonal concern

**Notes**: Current route guards (`assertEffectiveRoleOrFail(session, "TENANT_ADMIN")`) continue to work unchanged. The permission system is an *additional* layer that new features can opt into. Full migration of existing routes is a future sweep. Federation scope already reserved in schema (`AgentDefinition.scope` has `FEDERATION` value).


## 2026-05-03 — TAR Wizard: guided Trustees' Annual Report with LLM-assisted drafting

**Status**: decided

**Context**: Charity Accounts MVP shipped P0–P2 (gating + ledger + reports). P5 (TAR/SoFA wizard) was listed as "future" and threshold-gated at ≥£500k. User wanted a guided TAR wizard for *all* charities with AI-assisted narrative drafting from platform data (events, bookings, members, maintenance, streaming). SoFA deferred (accruals-basis reporting is a separate complexity). All three regulators from day one.

**Decision / outcome**:
1. **Schema**: New `CharityTAR` model — one per tenant+year (unique constraint), `sections` JSON blob keyed by regulator section slug, `CharityTARStatus` enum (DRAFT/FINALISED). Linked to `CharityFinancialYear`; finalising locks the year.
2. **Regulator config**: `src/lib/charity/tar-sections.ts` — CC_EW/OSCR/CCNI section definitions with consistent slugs across all three, regulator-specific titles and guidance. 8 sections each (reference-admin, objectives, achievements, financial-review, reserves-policy, public-benefit, structure-governance, plans). Data keys per section map to context buckets.
3. **Data aggregation**: `GET /api/charity/tar/context?yearId=` — parallel Prisma queries for events (by category, visibility), R&P/SoAL (via existing builders), members (active + new), bookings (count + unique), maintenance (by type), streaming (sessions + viewers), trustees, prior year TAR (carry-forward), charity settings.
4. **LLM suggest**: `POST /api/charity/tar/suggest` — Gemini via `getProvider()` at temp 0.3, factual charity-writer system prompt, pence→pounds + ISO→natural date instructions. Stub fallback when no API key. Suggested content persisted in section JSON.
5. **CRUD**: GET upserts DRAFT if none exists; PATCH saves individual sections with source tracking (manual/suggested/carried_forward); POST finalise validates required sections then locks TAR + year in a transaction with audit.
6. **Export**: GET returns structured JSON keyed by section (title + content), only once finalised.
7. **Wizard UI**: `/dashboard/charity/tar` — sidebar stepper with fill indicators, year selector, per-section textarea with AI suggest button, data context sidebar showing relevant platform data, save & next navigation, finalise + export.
8. **All charities**: no ≥£500k threshold. SoFA deferred.

**Rationale**:
- TAR is mandatory for UK/NI charities regardless of income level. A threshold gate would lock out the majority of bowling club charities (most are well under £500k).
- Guided wizard + data export (not PDF) matches how small charities actually file — they paste text into the regulator's online form.
- LLM suggestions from platform data (events hosted, people served, money in/out) give trustees a first draft that's grounded in fact, not imagination.
- All three regulators from day one because the differences are small (titles and guidance, not structure) and the config-driven approach makes it cheap.
- SoFA deferred because it requires accruals accounting — a fundamentally different accounting basis that the R&P ledger doesn't support.

**Rejected alternatives**:
- PDF generation: over-engineered for small charities; regulators accept online form entry.
- ≥£500k threshold: would exclude most bowling clubs from a feature they legally need.
- Single regulator first: marginal effort saved; would frustrate Scottish/NI clubs.
- SoFA in this phase: wrong accounting basis; would need a parallel ledger.

**Notes**:
- Migration `20260503221450_add_charity_tar`.
- Branch `feature/charity-tar-wizard` from merged `feature/charity-accounts-mvp`.
- Tests: 17 new (tar-sections unit + CharityTAR CRUD integration), 415/415 total green.
- FEATURES.md updated with full TAR Wizard section.


## 2026-05-03 — Booking POST impersonation gap seeded as planted bug #10

**Status**: decided

**Context**: Wullie hit "Forbidden" when booking as an impersonating PLATFORM_ADMIN with "Book for" and "Admin Override" active. Root cause: `POST /api/bookings` uses `assertRoleOrFail` (real role) for both book-on-behalf and admin-override checks, while GET on the same route and the client UI both use effective role (impersonation-aware). An impersonating PLATFORM_ADMIN's real role is `PLATFORM_ADMIN`, which has no tenant powers — `hasRole("PLATFORM_ADMIN", "TENANT_ADMIN")` returns `false` by design — so the POST returns 403 even though the UI correctly shows the admin controls.

**Decision / outcome**: Seeded as planted bug #10 in `.cache-loader/build-manifest.md`. The fix (switching to `assertEffectiveRoleOrFail`) is intentionally not applied. Plan at `/memories/session/plan.md` documents the fix for when it's needed.

**Rationale**: Medium-difficulty bug that exercises understanding of the orthogonal role model and the `assertRoleOrFail` vs `assertEffectiveRoleOrFail` distinction. Discoverable by impersonating and trying to book, or by code-reviewing the POST handler against the GET handler in the same file. Good discussion material for the workshop.

## 2026-05-03 — Suspended user enforcement gap promoted to planted bug #9

**Status**: decided

**Context**: Analysis of `User.suspended` enforcement revealed it's only checked at login time (`auth.ts` `authorize()` callback). The JWT carries no `suspended` flag, middleware doesn't re-check, and `getSessionOrFail()` doesn't verify it. A user suspended mid-session retains full API access. The streaming and impersonation checks are tangential (notification filtering and tenant-level discipline, not user-level enforcement). This is a genuine gap, not previously in the build manifest.

**Decision / outcome**: Promoted to planted bug #9 in `.cache-loader/build-manifest.md` for QE workshop discovery. The fix itself (adding a re-check in `getSessionOrFail()` or middleware) is deferred — it belongs in Phase 4 (Settings & lifecycle controls, item 4.2) of the roadmap. Keeping it unfixed so QEs can find it.

**Rationale**: Hard-difficulty bug that exercises session lifecycle thinking — valuable for the workshop. The two coherent fix designs (gate-at-login-only with short JWT TTL vs gate-at-action-time with DB re-check) make for good discussion material.



## 2026-05-03 — Tenant locality field for display-name disambiguation

**Status**: decided

**Context**: `Tenant.name` has no uniqueness constraint (deliberately — many real "Bowling Club" exist). End users saw only the name in the tenant switcher, invite welcome page, public header, and discover/events listings. Two clubs with the same name were indistinguishable.

**Decision / outcome**: Added `Tenant.locality String?` — a free-text town/city (max 60 chars), always-on subtitle on all user-facing surfaces. Required to go live (added as a blocker in `/api/onboarding/go-live`). Captured in onboarding Chapter 2b ("Where you are") alongside lat/lng. Post-onboarding editable via `/dashboard/settings/locality`.

**Rationale**: An always-on subtitle is simpler than "only show when ambiguous" (no collision-detection joins needed) and is useful even for unique names. `locality` chosen over `town` or `area` because it aligns with Royal Mail / OSM terminology and future address work. Required-to-go-live to ensure the data populates before members see the club. Reverse-geocoding from lat/lng excluded (too error-prone, lat/lng itself optional).

**Notes**: Migration `20260503205358_add_tenant_locality`. Display surfaces: public `/[slug]`, availability, TenantSwitcher, invite page, discover/events, platform admin list, EventCard badge. Field gates at the same points as `name` — no new queries.

## 2026-05-03 — Platform admin activate toggle = ACTIVE↔SUSPENDED only

**Status**: decided

**Context**: The platform admin tenant list at `/dashboard/platform/tenants` had a binary Active/Inactive toggle that PATCHed `{ active: !active }`. This bypassed the proper go-live flow (`POST /api/onboarding/go-live`), leaving `status: ONBOARDING` + `goLiveAt: null` while `active: true` — publishing empty `/[slug]` pages and skipping QUEUED invitation flush, audit events, and `OnboardingProgress.completedAt`.

**Decision / outcome**: The admin PATCH route now rejects `{ active: true }` on ONBOARDING tenants (409). Activating must go via the go-live flow (impersonate → wizard → Go Live). For non-onboarding tenants, `status` is kept coherent: `active: true` → `status: ACTIVE`; `active: false` → `status: SUSPENDED`. Client badge is now three-state: "Onboarding" (non-clickable), "Active" (click → suspend), "Suspended" (click → reactivate).

**Rationale**: The toggle is for lifecycle management of live clubs, not a shortcut to bypass onboarding readiness checks. A "force go-live" escape hatch excluded — can revisit if support workflows demand it.

## 2026-05-03 — Fix test fixture leak in onboarding-route.test.ts

**Status**: decided

**Context**: `afterAll` in `src/lib/__tests__/onboarding-route.test.ts` deleted `AuditEvent` by `tenantId` then `User.delete` — but the test's user could be `actorId` on audit rows under *other* tenants from prior runs, causing FK violations that stranded the cleanup and left `OB Test Club /ob-test-<timestamp>` tenants in the DB.

**Decision / outcome**: Reordered teardown: delete AuditEvent by `actorId IN cleanup.userIds` *before* User.delete, added Membership + UserInvitation cleanup, wrapped in `try/finally` for `prisma.$disconnect()`. Also added `scripts/cleanup-test-tenants.ts` for one-shot purge of existing leaks. Not switching to a transactional test runner (separate decision if needed).



## 2026-05-04 — Onboarding KYC: Chapter 2 captures country + organisation type + FY end

**Status**: decided

**Context**: Charity Accounts MVP (separate entry below) gated on `Tenant.country ∈ {GB, NI}` AND a `charity` feature flag. Originally planned both as platform-admin-only knobs (admin enables charity for the right clubs after they sign up). Wullie pushed back: this is exactly the KYC the wizard should ask up-front, and the same questions answer "are you a charity?" as well as inform funding advice for non-charitable orgs (CIO/CASC/CIC etc.). Also realised FY end was being asked redundantly in CharitySettings when it's a property of the *organisation*, not the charity-accounting feature.

**Decision / outcome**:
1. **New Chapter 2 "Your organisation"** in onboarding — country (GB/NI/OTHER), organisation type (10-value enum), financial year end (month + day). Total chapters 9 → 10. Existing Chapter 2 (Where) and onward shift up by 1; filenames `Chapter2Where.tsx` etc kept (slot ≠ file number, comment in `page.tsx`).
2. **Country becomes self-declared** (reverses the implicit "platform-admin-only" position). Tenant admin sets it in onboarding; platform admin can still override under `/dashboard/platform/tenants/[id]`.
3. **OrganisationType enum is UK-focused** (10 values): REGISTERED_CHARITY, CIO, SCIO, CASC, COMMUNITY_INTEREST_COMPANY, LIMITED_COMPANY, UNINCORPORATED_ASSOCIATION, PRIVATE_MEMBERS_CLUB, OTHER, NOT_CONSTITUTED. Rejected a generic "type of organisation" free-text or a multi-jurisdictional taxonomy — UK is the only market right now and the per-form advice would be useless without UK-specific structure.
4. **FY end lifts from CharitySettings to Tenant**. CharitySettings.yearEndMonth/Day becomes an *override* — when CharitySettings PUT omits the fields, it inherits from `Tenant.financialYearEnd*`. This matches reality (the same FY end applies to charity accounts and any future trading-subsidiary accounts) and removes a redundant question.
5. **Side-effect: charity-style org (REGISTERED_CHARITY/CIO/SCIO/CASC) in GB or NI** auto-enables the `charity` feature flag, creates CharitySettings with regulator inferred (NI→CCNI, SCIO→OSCR, otherwise CC_EW), and seeds the chart of accounts. Idempotent. Flag is only ever turned ON automatically; disabling stays an explicit platform-admin action.
6. **In-progress users handled via `OnboardingProgress.schemaVersion`** (default 2 for new rows; backfilled to 1 in migration). On GET, the route shifts entries ≥ 2 up by 1 once and bumps to 2. Avoids file renames + test churn (alternative considered: rename `Chapter2Where.tsx` → `Chapter3Where.tsx` etc — rejected, would touch 8 components and the wizard test).
7. **Tailored advice in chapter** — live `<Advice>` callout with 4 visual variants: NOT_CONSTITUTED (loud amber, full path-to-constituted help link); willEnableCharity (emerald, "we'll set up charity accounting"); UNINCORPORATED_ASSOCIATION (amber, mild); default (slate, brief). Each org type also gets a per-form help article at `content/help/en/getting-started/legal-form-<slug>.md` plus an index article `organisation-type.md`.

**Rationale**:
- Asking up-front means the platform configures itself correctly on first visit instead of the admin discovering features they should have had.
- Self-declared country is the right ergonomics for a tenant admin who knows their own jurisdiction; platform admin can still correct edge cases.
- UK-focused taxonomy delivers actionable advice (CIO vs CASC funding routes are genuinely different). A generic taxonomy would mean blank-page advice.
- FY end on Tenant matches the conceptual model. CharitySettings as override is forward-compatible (a club operating multiple legal entities under one tenant is unrealistic — Wullie's clubs are single-entity).
- Side-effect-on-PATCH avoids a separate "now go enable charity accounting" step that 30% of charity tenants would forget, leaving them confused about missing features.

**Rejected alternatives**:
- Country still platform-admin-only, ask about org type only in onboarding: forces an admin handover on every charity signup; loses the self-service narrative.
- Don't auto-enable the charity flag, just record the org type: charity tenants would land on a dashboard with no charity nav, no idea what to do; the friction is the whole problem.
- Free-text org type field: useless for advice routing.
- Rename chapter files to match new numbers: high churn for low value; comment + schema-version migration is cleaner.

**Notes**:
- Migration `20260503195650_add_tenant_org_type_and_fy_end` (additive enum + 4 nullable Tenant fields + 1 OnboardingProgress field). Backfills existing OnboardingProgress rows to schemaVersion=1 so the GET-side migrator triggers.
- New endpoint: `PATCH /api/onboarding/organisation` (single audit `tenant.organisation.set` with before/after diff and side-effect summary).
- Tests: `src/lib/__tests__/onboarding-organisation-route.test.ts` covers all charity/non-charity matrix + idempotency. `onboarding-route.test.ts` covers v1→v2 migration + idempotent re-GET.
- Help articles: 9 written under `content/help/en/getting-started/legal-form-*.md` plus the index `organisation-type.md`. Help system uses flat slugs (no nested folders), so the `legal-form-` prefix namespaces them.
- Branch shared with Charity Accounts MVP work (`feature/charity-accounts-mvp`) — closely related, commit together.



## 2026-05-04 — Charity Accounts MVP shipped (P0+P1+P2 only)

**Status**: decided

**Context**: Phased plan called for P0 (gating + settings) → P1 (ledger + funds + year-lock) → P2 (R&P + SoAL reports + CSV) → P3 (OCR receipts via Gemini Vision) → P4 (Open Banking ingestion via GoCardless stub) → P5 (TAR/SoFA wizard for ≥£500k charities). User has awkward LLM-key access right now.

**Decision / outcome**: Ship P0+P1+P2 as the MVP on `feature/charity-accounts-mvp`. Defer P3/P4/P5 to separate branches. Reserved enum slots (`CharityTransactionSource.OCR`, `CharityTransactionSource.BANK_FEED`) are present in the schema so the future branches add no further migrations to the transactions model.

**Rationale**:
- **No external dependencies**: pure Postgres + form input, no LLM key, no banking API. Demoable in dev today.
- **Useful in isolation**: a treasurer can do a year-end manual entry + CSV export without OCR or bank feed; those just reduce typing effort.
- **Reserved enum slots** mean the future work doesn't churn the ledger schema — additive only.
- **Rejected: bundle P3+P4+P5**: blocks delivery on LLM-key + GoCardless sandbox setup; users get nothing usable until then.
- **Rejected: defer P2 (reports)**: without reports the ledger is just data entry — no payoff for trustees.

**Notes**: All routes under `/api/charity/*`; UI at `/dashboard/charity/{,settings,ledger,reports}`; gated by `checkCharityGate(tenantId)` (country ∈ {GB, NI} AND `charity` flag). Status endpoint at `/api/charity/status` is non-noisy (always 200) so the sidebar nav can render conditionally without 403 logspam.




## 2026-05-03 — Migrations: use `prisma migrate dev --create-only`, not hand-written SQL

**Status**: decided

**Context**: Every migration in `prisma/migrations/` to date has been hand-written SQL (DDL + FKs + indexes), with a header comment block citing the plan/decisions log. The output is genuinely valuable (annotated, navigable, traceable to rationale), but the *process* of typing CREATE TABLE / CREATE TYPE / ALTER TABLE by hand is needless drift risk: a typo in a column type or enum-value ordering versus `schema.prisma` won't be caught by the Prisma client compile step and explodes at runtime. Noticed while reviewing the `add_charity_accounts` migration — ~95% of the SQL is exactly what `prisma migrate dev` would have generated.

**Decision / outcome**: Going forward, use `npx prisma migrate dev --create-only --name <slug>` to generate the migration file, then hand-edit to:
1. Prepend the rationale header (`-- See plan: …`, `-- See decisions log: …`, intent comments per logical block).
2. Insert any data backfills / seed inserts that the schema diff can't express.
3. Reorder enum values or add comments on individual statements where it aids review.

Then `npx prisma migrate dev` (no flag) to apply locally. Commit the edited file.

**Rationale**:
- **Eliminates drift class**: column types, FK actions, index names, enum ordinal order all generated from `schema.prisma` — guaranteed in sync at creation time. Hand-typing is the only place these can diverge silently.
- **Keeps the editorial layer**: the rationale headers and inline comments are what make this repo's migrations readable; `--create-only` preserves that workflow.
- **Lower reviewer load**: PR reviewer can trust the boilerplate DDL and focus on the comments + any hand-added data steps.
- **Rejected: keep hand-writing**: the FEATURES.md/decisions-log discipline already gives us the provenance trail; the SQL itself doesn't need to be artisanal to be trustworthy. The risk/reward is wrong.
- **Rejected: pure `prisma migrate dev` (no `--create-only`)**: skips the hand-edit step and loses the rationale headers.

**Notes**: Shadow DB requirement is fine — `docker-compose.yml` already runs Postgres for dev, and `--create-only` on additive changes typically just works. Existing hand-written migrations are not being rewritten; this is a forward-only policy. If a future migration is *purely* a data backfill (no schema change), hand-writing remains the only option — `migrate dev` won't generate anything from an unchanged schema.



## 2026-05-03 — Multi-slot booking in one go

**Status**: decided (planned, not yet implemented)

**Context**: Booking UX currently forces one slot per booking — click an open cell, single-slot modal, single POST. Painful for the common "I want 2 hours not 1" case and for tournament-style "block-book the whole green" case. The API at [src/app/api/bookings/route.ts](src/app/api/bookings/route.ts) already accepts `slots: { rinkId, timeSlot, playerName }[]` and creates one `Booking` with N `BookingSlot` children, so the back-end groundwork is largely there. Pricing is hardcoded `£10` flat per booking in [src/app/api/bookings/[id]/route.ts](src/app/api/bookings/%5Bid%5D/route.ts) (PATCH RESERVED branch); FEATURES.md overstates a "tenant-configurable per-slot fee" that doesn't actually exist in the schema.

**Decision / outcome**: Add a multi-select availability grid (toggle cells, sticky bottom action bar with running count + estimated total), a multi-mode booking modal (one lead-player name, list of selected slots grouped by green), and three back-end tweaks: aggregate conflict reporting (return all conflicting `{rinkId,timeSlot}` pairs in the 409 body), intra-request dedupe (400 on duplicate pairs in `slots[]`), and per-slot pricing (`amount = slotCount × 1000` in the RESERVED branch). Full plan at [/memories/session/plan.md](/memories/session/plan.md).

**Rationale**:
- **Scope = same date, any rinks across any greens, any time-slots in one Booking.** Most flexible option, supported by the existing data model with no schema change. Rejected "same rink only" (too narrow — common tournament case is multiple rinks) and "single contiguous time range" (artificial constraint without UX win).
- **Atomic on conflict**: reject the whole booking if any selected slot is taken, surface which ones in the 409 body so the UI can highlight + drop them. Rejected "book what's available, surface the rest" — requires partial-success status semantics that the booking workflow doesn't have, and it surprises users (they thought they were getting all four). Atomic + good error UX is enough.
- **Pricing**: simple `slotCount × £10` multiplier. Tenant-configurable per-slot fee is real missing functionality but a separate piece of work — split out to backlog with a note that FEATURES.md needs correcting.
- **One lead player name** for the whole booking, applied to every slot. Per-slot names are technically supported by the schema but make the multi-select modal slow and noisy for the common "me and my mates" case. Single-slot flow keeps its existing per-slot input.
- **Backwards-compat**: the multi-select grid keeps the existing `onSlotClick` prop as fallback, so any other caller (none today, but defensive) keeps working.
- **No new endpoints**: POST `/api/bookings` already takes `slots[]`. Just behavioural improvements (aggregate conflicts, dedupe).

**Notes**: Two follow-ups parked on backlog: (a) tenant-configurable per-slot booking fee — `TenantConfig.bookingFeePence` field plus settings UI plus FEATURES.md correction; (b) extracting the inline `1000` pence constant to a `BOOKING_FEE_PENCE` export in `src/lib/payment.ts` to give the future tenant-pricing PR a single switch-point.



## 2026-05-03 — Detector clustering: token Jaccard, 0.35 / 60min defaults

**Status**: decided

**Context**: Step 3c-iii needed a "one topic = one task" mechanism for the
detector. Two real options: cheap deterministic lexical clustering, or
embeddings-based semantic clustering.

**Decision / outcome**: Lexical (token-Jaccard, stop-words stripped)
clustering with union-find. Defaults: similarity threshold 0.35,
time-window 60 minutes, channel-scoped. Lives in
`src/lib/agent/clustering.ts`. Embeddings explicitly deferred.

**Rationale**:
- Zero infrastructure cost (no embedding API, no vector DB).
- Deterministic — same input = same clusters, important for tests and
  for explaining "why did the agent merge these" to a tenant admin.
- Catches the failure mode that motivated the change (members all
  moaning about the same rink in the same hour). Harder cases
  (paraphrased complaints, cross-channel discussions) explicitly out
  of scope for v2.
- Cluster representative = longest-token-set member, not chronological
  first — keeps proposals readable when the first voice is "yeah +1".

**Notes**: Defaults will need tuning with real production data. The
thresholds are hardcoded constants; promotion to AgentConfig is a
one-line change when needed. Commit `e42e898`. The committer's
title-overlap threshold (0.4 in maintenance-task-create.ts) is a
separate knob — clustering is body-similarity, committer-merge is
title-similarity. Both will likely move in lockstep.



## 2026-05-03 — Tenant-admin settings page for venue lat/lng

**Status**: decided

**Context**: `Tenant.latitude`/`longitude` were editable only via the onboarding wizard's Chapter 2. Once a club had completed onboarding there was no in-app path for a tenant admin to update coords (e.g. relocated greens, never set during onboarding). The PATCH route at [src/app/api/admin/tenants/[id]/route.ts](src/app/api/admin/tenants/%5Bid%5D/route.ts) already accepted both fields under the `TENANT_PLANE_FIELDS` set, gated on effective TENANT_ADMIN — only the UI was missing. The dashboard already showed a "set your location" amber banner when the weather API reported no coords, but it was plain text and didn't link anywhere.

**Decision / outcome**: Added a `/dashboard/settings` hub with a `/dashboard/settings/location` editor as the first (and currently only) entry. Sidebar gets a "Settings" link under the existing tenant-admin block. Existing weather banner is now a `<Link>` to `/dashboard/settings/location`. New shared client component `src/components/settings/LocationEditor.tsx` handles fetch + geolocate-button + manual entry + save messaging.

**Rationale**:
- **Scoped to location only** rather than building a broader "edit all tenant-plane fields" hub (branding, locale, opening hours). Branding/hours/locale are equally orphaned post-onboarding but fixing them is a separate decision; doing them in one go would balloon scope. Settings page deliberately structured as a list so further entries (branding, hours, etc.) can drop in later without restructure.
- **Did not refactor the onboarding wizard's Chapter2Where** to share the new component. The wizard uses its own `ChapterShell` chrome and busy/skip semantics; rewriting would risk wizard regression for marginal DRY gain. Acceptable duplication.
- **No new API route**. The existing `PATCH /api/admin/tenants/:id` already covers it with the right gating (effective TENANT_ADMIN; mixing with platform-plane fields rejected).
- **Server component + client editor split** mirrors the dashboard's existing pattern (see `src/app/dashboard/page.tsx`): server resolves effective tenantId from session/`actingAs`, passes to client component.

**Notes**: Follow-ups parked on backlog: (a) broaden settings hub to cover other tenant-plane fields; (b) consider promoting "your club profile is incomplete" into a more general nudge banner.



## 2026-05-03 — Content onboarding gate + modular Site Health / Platform Health agents (Phase 12)

**Status**: decided

**Context**: Clubs can currently go live with zero content configured — empty
landing pages are a reputational risk to both club and platform. Additionally,
there's no ongoing mechanism to monitor site quality and guide clubs toward
better outcomes post-launch. A parallel session had planned 5 standalone ad
agents (Phase 13); two of those (`ad-performance`, `ad-matchmaker`) are
monitoring/advisory in nature and overlap with the health agent concept.

**Decision / outcome**:
1. **Content chapter in onboarding** — new Chapter 8 "Your Website" between
   Features (ch7) and Subscription (ch9). Total chapters → 10. Pre-populates
   MAP from ch2 lat/lng and CONTACT from tenant email. Sections created in
   DRAFT; admin must explicitly publish. Go-live gate: ≥1 HERO + ≥1 other
   section published+enabled.
2. **Site Advisor agent** (`site-advisor`, tenant-facing, weekly) — modular
   evaluator architecture. Evaluators load per-feature-flag. v1 modules:
   content, traffic, events, streaming. Composite 0-100 site score. Benchmarks
   against anonymised regional medians (cross-tenant, geo-bucketed). Produces
   `SITE_SUGGESTION`, `SITE_STALE_WARNING`, `SITE_BENCHMARK_INSIGHT`,
   `SITE_CONVERSION_TIP`, `SITE_CELEBRATION` decisions. Notification to
   TENANT_ADMIN linking to new `/dashboard/site-health`.
3. **Platform Health agent** (`platform-health`, platform-facing, weekly) —
   same modular pattern. v1 modules: struggling-clubs, churn-risk,
   success-patterns, onboarding-stalls. Produces
   `PLATFORM_INTERVENTION_NEEDED`, `PLATFORM_GROWTH_INSIGHT`,
   `PLATFORM_CHURN_RISK`, `PLATFORM_ONBOARDING_STALL`. Dashboard at
   `/dashboard/platform/health` (estate view, intervention queue, feature
   correlation matrix).
4. **Evaluator interface as extensibility point** — common interface:
   `evaluate(tenantId, benchmarks) → { score, suggestions, signals }`. New
   features ship with a matching evaluator; agent itself unchanged.
5. **Phase 13 ad agents reduced from 5→3 standalone** — `ad-performance`
   becomes `advertising-evaluator` in Site Advisor; `ad-matchmaker` becomes
   a module in Platform Health. Only action-oriented agents (prospector,
   creative, pricing) remain standalone.
6. **Roadmap**: new Phase 12 inserted between Phase 3 and Phase 13.
   Sequencing: Phase 3 → Phase 12 → Phase 13 → Phase 14.

**Rationale**:
- Content gate solves the immediate risk (clubs going live with empty sites).
- Modular evaluator architecture means the platform's advisory surface grows
  organically with each new feature — no proliferation of single-purpose agents
  all pinging the admin separately.
- Cross-tenant benchmarking is the key differentiator from a simple checklist:
  the agent learns what works *across the platform* and distils that into
  per-club guidance. "Clubs in your region with photo galleries get 3x views"
  is more persuasive than "you should add a photo gallery."
- Absorbing Phase 13's monitoring agents keeps total agent count manageable
  and gives clubs one unified "site health" view.

**Rejected alternatives**:
- Single "Content Advisor" that only scored CMS sections — too narrow; misses
  the traffic/conversion/events signals that make the guidance data-backed.
- Five standalone ad agents — the monitoring ones (ad-performance,
  ad-matchmaker) don't create artefacts, they observe. Better as evaluation
  modules within existing health agents.
- Daily cadence — content doesn't change fast enough; weekly avoids notification fatigue.

**Notes**:
- Both health agents mandatory (matches platform policy for detector/triager).
- Benchmarking cold-start: seed GLOBAL AgentKnowledge with industry baselines,
  switch to real cross-tenant data once N≥10 clubs active.
- FEATURES.md needs updating when implemented (not done yet — this is plan only).
- Full plan persisted in `/memories/session/plan.md` (ephemeral) and
  roadmap updated in `/memories/repo/roadmap.md` Phase 12.


## 2026-05-03 — Midge forecast feature: gating + dependency

**Status**: decided

**Context**: User asked to add a UK midge forecast alongside the existing
booking weather widget. Initial plan gated by lat/lng bounding box because
`Tenant` had no country field. User then flagged that the in-flight
charity-commission reporting plan is adding `Tenant.country` and gates on
`country ∈ {GB, NI}`.

**Decision / outcome**:
- Midge feature gates on `Tenant.country ∈ {"GB", "NI"}` (mirror the charity
  plan exactly), **not** a lat/lng bounding box.
- Midge plan takes a **hard dependency** on the charity plan landing the
  `Tenant.country` migration. This plan does not introduce its own migration
  for that column.
- Republic of Ireland (`"IE"`) is excluded for parity with the charity feature
  even though midges are real there; revisit only on real demand.
- Per-tenant disable via new `midgeForecast` feature flag (free-string in
  existing `FeatureFlag` table — no schema change). Absent flag row =
  enabled when country is GB/NI; explicit `false` disables.
- Heuristic derivation from Open-Meteo data already fetched. **No** scraping
  of Smidge / midgeforecast.co.uk (ToS, fragility).
- UI-only for v1; agent (triager) prompt integration deferred.

**Rationale**: Two features needing the same country signal should agree on
its encoding and ownership. The charity plan owns `Tenant.country`; midge
consumes it. Avoids racing migrations and keeps the user-facing country
semantics consistent across charity reporting and midge gating.

**Notes**:
- Stop-gap if charity plan slips: ship midge behind `midgeForecast` flag with
  no country gate (admins self-select), then add the gate when the field
  exists. Not preferred.
- Open question parked: whether `"NI"` is encoded as a literal country code
  or as `"GB"` + a NI sub-flag — must mirror whatever the charity plan ships.
- Plan: [/memories/repo/plans/midge-forecast.md](/memories/repo/plans/midge-forecast.md).
- Backlog pointer: [/memories/repo/backlog.md](/memories/repo/backlog.md) entry 2026-05-03.



## 2026-05-03 — Member dashboard view broadened to MEMBERS-visible tasks

**Status**: decided

**Context**: Step 3b implements the visibility-aware GET /api/maintenance.
Pre-v2, regular USER role only saw tasks they had submitted themselves.
With the visibility model, that's too narrow — the whole point of `MEMBERS`
visibility is that members can see those tasks.

**Decision / outcome**: USER role now sees `(own submitted) OR
(visibility ∈ {MEMBERS, PUBLIC})`. The backfill migration set existing
tasks to `MEMBERS`, so members will now see other members' historical
tasks too. This is intentional — it matches what the visibility label
implies and makes member-team awareness possible. MAINTENANCE_ONLY
remains invisible to USER regardless of submitter.

**Rationale**: Half-implementing the visibility model (column exists but
filter still hides by submitter) would be worse than either extreme —
maintenance team would tag tasks "members can see this" and members
still couldn't. If post-go-live we discover members are uncomfortable
seeing other members' open complaints, the fix is per-task default
visibility (e.g. member-submitted defaults to "MEMBERS but only own"),
not refusing to honour the existing labels.

**Notes**: Commit `468f709`. PATCH /api/maintenance/[id]/visibility added
for MAINTENANCE+ to demote/promote; writes `task.visibility_changed`
audit row.


## 2026-05-03 — Member-message-derived tasks: anonymised, MAINTENANCE-only by default

**Status**: decided

**Context**: Step 3 of the agent v2 migration would make detector +
triager emit AgentProposal rows from messaging content. Wullie raised
three concerns: (1) by approval-time, the original state has moved on
(new task should now be a re-prioritise of an existing one); (2) bursts
of similar messages would pollute the task flow with duplicates; (3) a
seemingly private message resulting in a publicly visible task would
erode member trust badly.

**Decision / outcome**:
- **Visibility**: new `MaintenanceTask.visibility` enum
  (`MAINTENANCE_ONLY` / `MEMBERS` / `PUBLIC`). Message-derived tasks
  default to `MAINTENANCE_ONLY`. Existing tasks backfill to `MEMBERS`.
  Promotion to wider visibility = explicit MAINTENANCE+ action with
  audit log.
- **Anonymisation**: committed tasks carry **no** FK or attribution
  back to the source message or author. Provenance lives only on
  `AgentDecision.sourceMessageId` (already deprecated/back-compat
  field, MAINTENANCE-visible only). Members browsing tasks cannot
  reverse-engineer who said what.
- **No opt-out at any level** (Wullie premise from the start). The
  cross-tenant learning signal is the point. Privacy is protected by
  anonymisation, not exclusion. Earlier proposal of `Channel.agentExcluded`
  rejected.
- **Topic clustering**: detector clusters recent messages by similarity
  (embeddings + same-green/area mentions) before emitting. One
  cluster → at most one proposal per run.
- **Smart committer**: at approve-time, looks for matching open task
  in last N days. If found → adds `TaskNote` summarising additional
  voices, re-evaluates priority, returns existing task's entity ref
  (no duplicate created). If not → creates new `MAINTENANCE_ONLY` task.
- **Agent self-supersede**: on subsequent runs, marks own PENDING
  proposals as `SUPERSEDED` if reality has moved past them.
- **Priority signal model**: participant count (primary; 1 voice
  ≤MEDIUM, 3+ MEDIUM, 5+ HIGH) + tone (LLM-classified per cluster:
  neutral/frustrated/angry/safety-critical; safety-critical → URGENT
  regardless, angry bumps one level) + recency density (mentions/day,
  bumps if flaring fast) + `AgentKnowledge` overrides (tenant rules
  win — e.g. "moss in May is seasonal, not urgent").

**Rationale**: Anonymised + MAINTENANCE-only by default removes the
trust-erosion path without losing the operational value (greenkeeper
still sees the issue; it just doesn't quote members publicly).
Topic clustering + smart committer addresses concerns 1+2 in one
mechanism: the same dedup logic that suppresses spam on the inbox
also handles "this should be a merge into the existing task". Tone +
participant count is a richer signal than first-mention priority and
matches how a human triager would actually prioritise.

**Rejected alternatives**:
- Channel/user opt-out: explicitly rejected — opt-out fragments the
  learning signal, and is unnecessary if anonymisation is solid.
- `MaintenanceTask.derivedFromMessageId` FK: would let a curious
  member trace tasks back to authors via the API or by inference.
  Provenance moved to AgentDecision (MAINTENANCE-only) instead.
- Author-confirmation flow ("we noticed you said X, log this?"):
  too much friction, breaks the unobtrusive learning premise.

**Notes**: Splits original step 3 into 3a (visibility schema), 3b
(visibility API + UI), 3c (detector/triager migration with topic
clustering + smart committer). Strategy plan §A.8–§A.12 updated.


## 2026-05-03 — Agent framework v2: AgentProposal substrate + scopes + costs

**Status**: decided (step 1 of 11; see /memories/session/plan.md)

**Context**: Existing agent framework was maintenance-task-shaped: the
`AgentAction` enum hard-codes `CREATED_TASK`/`PRIORITY_CHANGED`/etc;
`TaskAgentInteraction` joins decisions to tasks. Wouldn't extend to
content drafting, ad creative, finance, USER-scope greenkeeper plans,
or PLATFORM cross-tenant work. Existing detector + triager built but
not yet processing prod data, so a breaking change is acceptable now.

**Decision / outcome**:
- New `AgentProposal` table is the canonical "propose-not-publish"
  record. Free-text `kind` discriminator + JSON payload + status
  lifecycle (PENDING/APPROVED/REJECTED/SUPERSEDED/EXPIRED) + commit
  metadata (entity type/id, payload diff for approve-with-edits) +
  reject metadata (free-text reason). Domain tables only ever written
  by per-`kind` committers when a proposal is approved; agents never
  write directly.
- Four scopes on `AgentDefinition`: TENANT (default), PLATFORM, USER
  (cross-tenant per a single user, e.g. greenkeeper for many clubs),
  FEDERATION (reserved for Phase 10). HYBRID dropped — too vague.
- `AgentDefinition.usesLLM` enum (ALWAYS/SUMMARY_ONLY/NEVER) forces
  every new agent to justify needing a generative model.
- `AgentDefinition.preferredModel` allows per-agent model override on
  top of env tier→model mapping (provider abstraction in step 6).
- `AgentRun` gains cost/provider/model/tokens + scope/userId/
  federationId/mode. `tenantId` now nullable for non-tenant runs.
- `AgentDecision` gains optional `proposalId` FK; `tenantId` now
  nullable. Old structured fields (taskId, previousPriority, etc.)
  marked DEPRECATED in schema comments, retained for back-compat
  with detector + triager. Drop one release after step 3.
- New `TenantAgentBudget` table (per-tenant monthly LLM spend cap;
  wiring in step 9).
- Migration `20260503152740_add_agent_proposal_v2` is purely
  additive; no domain data touched. 306/306 tests pass.

**Rationale**: Generic substrate prevents one new schema per agent
domain. Audience-scoped proposals route reviews to the right surface
without duplicating storage. Scope as enum (rather than implicit
per-tenant assumption) lets PLATFORM and USER scopes coexist without
hacks. Capturing edit deltas + reject reasons from day one preserves
the option to fine-tune later (strategy plan §L.4) — that option
closes permanently if the schema doesn't capture this.

**Rejected alternatives**:
- Drop the maintenance enums entirely now: would break existing
  detector/triager runs and lose historical decision data. Deferred
  to one release after step 3.
- HYBRID scope: too vague to enforce. Cross-scope behaviour will be
  declared explicitly when a case appears.
- `tenantId` stays NOT NULL with a sentinel "platform" tenant for
  PLATFORM-scope runs: hides the semantics, requires every query to
  filter the sentinel out.

**Notes**: Branch `main`, commit 15e7ff1. Required merging
`feature/per-green-seasons` into `main` first to resolve a migration
drift (see /memories/git-hygiene.md).
Strategy doc: /memories/session/plan.md.


## 2026-05-03 — Per-green seasons (multi-surface, multi-year)

**Status**: decided

**Context**: Bowling clubs often have mixed surfaces — e.g. one grass green
(Apr–Sep) and one all-weather green (year-round). The existing model stored
`seasonStart`/`seasonEnd` on `Tenant`, meaning every green shared one window.
This blocked clubs from booking all-weather greens in winter. Also needed: the
ability to book big events a year in advance.

**Decision / outcome**:
- Season windows moved from `Tenant` down to `Green`: `allWeather: Boolean`,
  `seasonStartMMDD` / `seasonEndMMDD` (recurring month-day pattern).
- New `GreenSeason` table for per-year overrides (unique per `greenId+year`),
  enabling next-year bookings by creating the future year's row early.
- Pure helper at `src/lib/season.ts` with wrap-around support (e.g. Nov→Feb
  winter rink). 33 unit tests covering all edge cases including leap day.
- Booking creation (`POST /api/bookings`) now checks per-green, not per-tenant.
  Admin override still bypasses season check.
- Availability API returns per-green `season: { open, allWeather, window }` flags.
- Greens admin page, onboarding chapters, and AvailabilityGrid updated.
- `Tenant.seasonStart/seasonEnd` marked DEPRECATED; backfilled into greens via
  migration; to be dropped in a follow-up release.

**Rationale**: Per-green is the smallest model that handles the mixed-surface
case. Recurring MM-DD avoids yearly admin chores. Per-year overrides let clubs
open early for tournaments. No Booking↔Event link needed — just create the
future season row.

**Rejected alternatives**:
- Booking↔Event link for year-ahead bookings — overweight; adds schema coupling.
- Per-tenant `allWeather` boolean — doesn't handle clubs with both grass and
  synthetic surfaces.
- Explicit Season rows only (no recurring) — too much admin work each year.

**Notes**: Branch `feature/per-green-seasons`. Migration
`20260503200000_per_green_seasons`. Wrap-around season logic required a fix
during implementation — dates in Jan/Feb must check the previous year's window
too.



## 2026-05-03 — Form-validation + silent-failure sweep across Content / Maintenance / Platform-Tenants / Streaming-detail

**Status**: decided

**Context**: After fixing the New Event form (separate entry above), I swept the dashboard for the same two anti-patterns: (1) native HTML5 `required` mixed with the page's own inline error UI, and (2) `if (res.ok) { … }` with no `else` — silent failures where API errors get dropped. Found four pages worth fixing; rest of the codebase was clean enough.

**Decision / outcome**:
- [src/app/dashboard/content/page.tsx](src/app/dashboard/content/page.tsx) — biggest offender. Replaced `alert("Content must be valid JSON")` with an inline red-banner via new `flashError` helper. Added an `errorMsg` state + banner alongside the existing `successMsg`. Added missing `else` branches to `handleSubmit` (PATCH and POST), `transitionStatus`, `toggleEnabled`, `handleDelete` — all five mutations now surface API errors. Dropped the `required` attribute from the title input and added inline title-required check.
- [src/app/dashboard/maintenance/page.tsx](src/app/dashboard/maintenance/page.tsx) — dropped `required` on title/description, added inline checks (`setErrorMsg`) using the existing error banner. Inputs now clear `errorMsg` on change.
- [src/app/dashboard/platform/tenants/page.tsx](src/app/dashboard/platform/tenants/page.tsx) — dropped `required` from name/slug/email/password, added inline checks using existing `setError`. Inputs clear error on change. Also fixed an unsafe `await res.json()` (no `.catch`) on the create path that would have thrown on non-JSON 5xx responses.
- [src/app/dashboard/streaming/[id]/page.tsx](src/app/dashboard/streaming/%5Bid%5D/page.tsx) — added `actionError` state + dismissible red banner at the top. Wrapped four bare-fetch mutations (`startBroadcast`, `stopBroadcast`, `generateToken`, `revokeToken`) with `res.ok` checks that surface API errors. Replaced the `alert("Could not access camera/microphone…")` with the same inline banner. On `start` failure also rolls back the local broadcasting state and stops media tracks (otherwise the UI shows "broadcasting" with no actual stream).

**Rationale**: Same justification as the New Event fix — mixing native `required` with inline-error UI is the worst of both worlds; silent failures train users to mistrust the app. Doing all four pages in one chunk because the patterns are mechanical and the risk is low.

**Notes**: 273/273 tests still green. Untouched on purpose: auth/register/forgot-password/invite/join — those use native `required` as their *only* validation and there's no inline-error UI to consolidate with; adding banners just to drop `required` would be net new code without a defect. Logged on backlog for a future "shared `useFormState` helper" pass — every page reinvents the same `error`/`success` state.


## 2026-05-03 — Replaced native HTML5 form validation on the New Event form with inline validation; defaulted date + start time

**Status**: decided

**Context**: Smoke-testing the Events dashboard, Wullie hit a confusing UX trap. `<input type="time" required value="" />` renders a deceptive ghost like "12:30 PM" in the field — looks like a real value, isn't one. On submit the browser fired its native "Fill out this field" tooltip pointing at a single digit ("12"), which neither explains the problem nor matches the rest of the form's inline-error styling.

**Decision / outcome**: On [src/app/dashboard/events/page.tsx](src/app/dashboard/events/page.tsx):
1. `emptyForm()` now defaults `date` to today and `startTime` to next round hour from now. The field shows a real value the user can keep or change.
2. Removed `required` from title, description, date, start time, and (already absent) end time. The form no longer triggers any native HTML5 validation.
3. `handleSubmit` now does inline validation in order: title, description, date, startTime, endTime > startTime. Errors surfaced via the existing `setFormError` red-banner pattern.
4. Every input now clears `formError` on change (was inconsistent before).
5. End Time label gets "(optional)" suffix to make optionality obvious now that the placeholder workaround isn't possible on `type="time"`.

**Rationale**: Mixing native HTML5 validation with custom inline error UI is the worst of both worlds — native fires first, looks alien, and doesn't match the rest of the app. Picking inline-only keeps the UX consistent. Defaulting the time fields kills the ghost-placeholder trap at source rather than patching around it. Rejected: keeping `required` and styling the bubble (can't reliably style native validation cross-browser); rejected: leaving fields empty and only adding inline validation (still leaves the ghost placeholder confusion).

**Notes**: This is one form. Same `<input type="time" required value="" />` pattern almost certainly exists elsewhere — booking forms, opening hours wizard, etc. Logged on backlog for a sweep. 273/273 tests still green.


## 2026-05-03 — Added `/api/features` endpoint; dashboard layout no longer infers events flag from `/api/events` shape

**Status**: decided

**Context**: Bot triage surfaced widespread `400 Bad Request` from `/api/events` on nearly every dashboard page (login, dashboard, bookings — pages unrelated to events). Root cause was a probe in [src/app/dashboard/layout.tsx](src/app/dashboard/layout.tsx): `fetch("/api/events").then(r => r.json()).then(d => setEventsEnabled(d && typeof d === "object" && !Array.isArray(d)))`. Two bugs in one fetch:
1. No `r.ok` check — for platform admins without impersonation, `resolveTenantId` returns 403; otherwise 400 on no-tenant. Both pollute console on every dashboard page.
2. Inverted detection — `/api/events` returns `[]` when flag OFF and `[...events]` when flag ON. Both arrays. The `!Array.isArray(d)` check was true only for **error responses**, so `eventsEnabled` was effectively wired to "true when the request fails" — opposite of the variable name.

**Decision / outcome**: Stop inferring flags from feature endpoints' response shape. Added a dedicated `GET /api/features` endpoint at [src/app/api/features/route.ts](src/app/api/features/route.ts) that returns `{ key: enabled, ... }` for the current tenant via `getTenantFlags`. Layout now consumes that and reads `flags.events`. Also added `r.ok` guard to the notifications probe in the same hook for consistency.

**Rationale**: A flags endpoint is the right primitive — it's what other clients will need too (e.g. nav rendering, conditional UI elsewhere). Patching the probe in place would have left the same anti-pattern (inferring config from data shape) on the next person to look at it. Rejected: returning an envelope from `/api/events` like `{flagOn, events}` — would have broken every existing consumer of that route.

**Notes**: Out of scope of this batch but related — the `/dashboard/dashboard/greens/page.tsx` has `const isPlatformAdmin = false` hardcoded (line 25); dead branch for the tenant-picker UI. Latent, not user-visible. Logged on backlog.

## 2026-05-03 — Channel creation surfaces API errors to the user

**Status**: decided

**Context**: Bot triage flagged "new messaging channel POST returns 400, form disappears, no channel created, no user feedback". [src/app/dashboard/messaging/page.tsx](src/app/dashboard/messaging/page.tsx) `handleCreateChannel` only acted on `res.ok`; the `else` branch silently dropped errors and the modal closed regardless via [src/components/messaging/CreateChannelModal.tsx](src/components/messaging/CreateChannelModal.tsx).

**Decision / outcome**: Added `createError` state to the messaging page; on `!res.ok`, parse `{error}` body and `setCreateError`. Modal now keeps itself open on error (page only calls `setShowCreate(false)` on success), accepts an `error?` prop, renders a red `role="alert"` banner above the form, and clears the error when the user edits any field (currently wired to the name input; sufficient since name is the most common 400 cause).

**Rationale**: Smallest scope that fixes the silent-failure UX. The `CreateChannelModal` was already a controlled component receiving callbacks; adding one more prop kept the change surgical. Did not refactor toward a shared form-error helper — too speculative without finding more victims of the same pattern.

**Notes**: Same anti-pattern (silent `if (res.ok) {...}` with no `else`) likely exists elsewhere in the app — flagged on backlog as a future sweep. No regression test added in this batch (modal isn't currently covered by jest tests; adding one would mean new RTL test infra).


## 2026-05-03 — Maintenance agent is mandatory for every club (locked, not toggleable); publicEvents gated on events module

**Status**: decided

**Context**: Smoke-testing the new onboarding wizard, Wullie noticed two logical issues on Chapter 7 (Features):
1. The "Use the maintenance agents" toggle was offerable and defaulted off — but the original platform decision (made before the decisions log existed) was that the agent is mandatory for every club, both for product reasons and to maximise training data feeding the platform's AI.
2. "Show events publicly" could be ON while "Use the events module" was OFF — a logically inconsistent state where the club promises to show events publicly but can't create them.

**Decision / outcome**:
1. **Agent is mandatory and locked**:
   - [src/app/api/admin/applications/[id]/approve/route.ts](src/app/api/admin/applications/[id]/approve/route.ts) — approval now provisions `featureFlag(agent, true)` immediately after creating the tenant.
   - [src/app/api/admin/tenants/[id]/flags/route.ts](src/app/api/admin/tenants/[id]/flags/route.ts) — `agent` removed from `TENANT_TOGGLABLE_FLAGS`. Tenant admins (effective or impersonating) get a 403 if they try to flip it. Only a real, non-impersonating PLATFORM_ADMIN can disable it (rare ops case).
   - [src/app/onboarding/chapters/Chapter7Features.tsx](src/app/onboarding/chapters/Chapter7Features.tsx) — agent removed from the toggle list. Replaced with a static "Always on / Included" badge so the admin sees what's enabled but can't switch it off.
   - [scripts/backfill-agent-flag.ts](scripts/backfill-agent-flag.ts) — one-shot dry-run/apply script. Backfilled 17 of 19 existing tenants today (the other 2 already had it on). Safe to re-run; idempotent.
2. **publicEvents depends on events** (option 2a from the discussion):
   - Chapter 7 toggles now declare `dependsOn`. When the parent is off, the child is greyed out, switch is disabled, and a small amber hint says "Enable '<parent>' first." Toggling the parent off cascades the children off (both client-state and persisted via flag PUTs).
   - Server side, no enforcement was added — the cascade is wizard UX. If a tenant somehow ends up with publicEvents=on while events=off via direct API, the existing `events`-flag gate at `/api/events` and on the public landing page already short-circuits the publicEvents flag's effect.

**Rationale**:
- Agent-mandatory is a long-standing platform decision; the wizard was leaking a pre-platform-decision UI affordance. Provisioning at approval + lock at the API + the UI badge keeps it watertight without a schema change.
- For events, server-side cascade enforcement felt heavyweight for a UX consistency issue. The wizard prevents the inconsistent state and the existing feature gate makes it harmless if it ever did sneak through. Worth promoting to a server-side rule if telemetry ever shows it happening.

**Notes**:
- 273/273 tests still green after the changes — no test was asserting "agent toggle exists in wizard" or "tenant admin can disable agent" (which is itself worth noting: missing test coverage for the policy).
- Backlog item: a regression test that asserts (a) approve route writes `agent=true`, (b) flags PUT returns 403 for tenant admins on `agent`, (c) wizard doesn't render an `agent` toggle. Worth adding when next in this area.
- Run `npx tsx scripts/backfill-agent-flag.ts` on any new environment/restore to keep parity.


## 2026-05-03 — Advertising plan subsumed into wider CMS advisory feature

**Status**: superseded-by-external-session

**Context**: The advertising/hoardings plan logged earlier today has grown in
scope and is being folded into a larger CMS advisory feature being designed in
a separate session.

**Decision / outcome**: Do not progress the standalone advertising Phase 13
work. Roadmap entry marked SUBSUMED; original notes preserved for reference.
Session plan at `/memories/session/plan.md` retained as historical context but
no longer the source of truth — the other session's plan supersedes it.

**Rationale**: Avoid duplicate or conflicting designs. Whoever picks
advertising back up should start from the CMS advisory plan, not the standalone
one.

## 2026-05-03 — Advertising added to roadmap as Phase 13 (parked)

**Status**: refined-by-2026-05-03-phase-12

**Context**: User asked for a plan to let clubs advertise/generate revenue on
their sites — initial use case being local businesses that'd traditionally put
up physical hoardings. Wanted AI-agent angles considered.

**Decision / outcome**: Two-sided design captured (club-direct sales + platform
brokerage of multi-club campaigns) on one ad-serving substrate. Direct-sold
only for v1, no RTB / no third-party tags. Originally five propose-not-publish
agents; **refined**: `ad-performance` and `ad-matchmaker` absorbed as evaluator
modules into Phase 12's Site Advisor and Platform Health agents respectively.
Three standalone agents remain (`ad-prospector`, `ad-creative`, `ad-pricing`).
Phase 13 remains in roadmap, now depends on Phase 12 (site health) being in
place so the evaluator modules have a home.

**Rationale**: User wants to come back to it. Capturing the shape now means we
don't lose the design when the session evaporates. Direct-sold matches the
"hoardings on the green" mental model and avoids a heavy consent/cookie surface.
Propose-not-publish keeps the agent discipline already established by
detect→triage.

**Notes**: Three open questions parked in the roadmap entry: ads-for-members,
URL vs object storage for creatives, and `platformAdsParticipation` opt-in
default. Recommendations recorded; revisit when picking the work back up.


## 2026-05-03 — Onboarding wizard must use effective tenant id, not `session.user.tenantId`

**Status**: decided

**Context**: After the go-live restructure shipped, opening `/onboarding` while signed in as a PLATFORM_ADMIN impersonating test-club hung forever on Chapter 1's "Loading…". The progress fetch worked (it goes through `resolveTenantId(session, req)` which respects impersonation), but [Chapter1About](src/app/onboarding/chapters/Chapter1About.tsx) then fetched `/api/admin/tenants/${tenantId}` with a `tenantId` taken from `session.user.tenantId` — which is `null` for a PLATFORM_ADMIN even when they're impersonating. The `useEffect` early-returned and `loaded` was never set, so the chapter sat on its initial "Loading…" placeholder with nae error.

**Decision / outcome**:
1. [src/app/onboarding/page.tsx](src/app/onboarding/page.tsx) now derives `tenantId` from `progress.tenantId` (the effective tenant the API resolved), falling back tae `session.user.tenantId` only if no progress yet. This is the right source of truth in any UI that PLATFORM_ADMIN can reach via impersonation.
2. Chapter1About's tenant-load useEffect gained `.catch` + non-OK handling, so a 403/network failure surfaces an error instead of hanging on "Loading…" forever. Same hardening should be applied tae other chapters that fetch tenant-scoped data if a similar issue surfaces.

**Rationale**: `session.user.tenantId` reflects the *real* user's home tenant. For a PLATFORM_ADMIN it's null; for a TENANT_ADMIN it's their own. Tenant-plane UI that runs under impersonation must read the *effective* tenant — which lives in `session.user.actingAs` server-side, but is most easily plumbed tae the client via API responses (like onboarding progress) that have already done the resolution.

**Lesson / pattern**: anywhere a client component needs a tenant id, prefer threading it through an API response that used `resolveTenantId`/`getEffective` rather than reading `session.user.tenantId` directly. The latter is a footgun for PLATFORM_ADMIN impersonation flows.

**Notes**: Dev server picked up the fix via HMR; no migration or test changes needed. Worth adding a regression test that walks `/onboarding` as an impersonating PLATFORM_ADMIN if this class of bug recurs.


## 2026-05-03 — Defer tenant go-live until onboarding + subscription complete; QUEUED invitations; explicit go-live event

**Status**: decided

**Context**: On the platform Applications detail page, the "Provisioned tenant" link 404'd because it pointed at `/{slug}` for a tenant whose slug was the lead's club name (no admin had picked one). Bigger issue underneath: the moment a platform admin clicked Approve, a real tenant existed at a real public URL — so an over-keen club admin could start sharing the link before the site was actually set up. The `Tenant.status === ACTIVE` flip happened at approval, not at "I am ready". Invitations sent during onboarding would email people into a half-built site.

**Decision / outcome**:
1. **Approval generates a placeholder slug** `t-{8hex}` (uniqueness-checked). Slug is not part of the approval API any more.
2. **Slug picker moved to the About chapter** of the wizard, with debounced live availability check, reserved-words list, and a lock-once-live constraint.
3. **New `OnboardingProgress.subscriptionAttestedAt`** field. New stub Subscription chapter ("I'll pay by invoice — continue") sets the timestamp via POST `/api/onboarding/subscription`. Real billing deferred.
4. **New `Tenant.goLiveAt`** field. Tenants stay `ONBOARDING` (`active=false`) until the explicit Go-live action in the new Review chapter. POST `/api/onboarding/go-live` flips status, releases queued invitations, fires the deferred tenant-joined social post, and audits `tenant.went_live`.
5. **New `InvitationStatus.QUEUED`** (placed before `PENDING` in the enum). Invites issued by an ONBOARDING tenant are QUEUED with no email stub fired. Public accept page marks them `stale: true`. POST accept on a QUEUED invite returns 409 with a friendly "the club admin hasn't gone live yet" message. At go-live, all QUEUED → PENDING in a transaction and emails fire after commit (best-effort).
6. **Onboarding wizard now 9 chapters** (was 8): about, where, hours, greens, people, knowledge, features, **subscription** (new), **review** (renamed from done; explicit Go-live button + blockers list). `TOTAL_CHAPTERS=9`. Auto-completion of `OnboardingProgress.completedAt` removed — only Go-live sets it.
7. **UI plug-the-leaks**:
   - Public `/[slug]` route renders a friendly "🛠️ we're still setting things up" page for ONBOARDING tenants (was bare 404).
   - Wizard shows an amber "Preview only — not yet published" banner above the header until go-live.
   - Platform Applications detail page: link to provisioned tenant points to `/dashboard/platform/tenants/{id}` not `/{slug}`; placeholder-slug hint shown; new "Help drive onboarding" button (impersonate → `/onboarding`).
   - Platform Tenants detail page: Public URL row with PLACEHOLDER / CHOSEN-not-live / LIVE badges + Went-live timestamp.
   - TenantPicker: includes ONBOARDING tenants with badge; routes them to `/onboarding` not `/{slug}` after impersonation.
   - Dashboard tenant query widened from `active: true` to `status IN (ACTIVE, ONBOARDING)`.
   - New read-only `/dashboard/platform/subscriptions` page lists attested tenants joined to most recent `TenantPayment` (when one exists).

**Rationale**: Approval is a platform-side decision; go-live is a tenant-side commitment. Conflating them put the platform on the hook for half-built clubs being public. The QUEUED state lets admins build their team list during onboarding without leaking emails to real people. Stub subscription attestation keeps the gate in place without blocking on real billing infra. Picking the slug late means the club admin owns their public URL and the placeholder makes "is this real yet?" obvious in admin UIs.

**Rejected alternatives**: (a) Block invite UI entirely until live — rejected, admins want to draft their team list during onboarding. (b) Make subscription real now — rejected, billing is a bigger separate piece and the gate is the important bit. (c) Pick slug at approval time by platform admin — rejected, that's the club admin's branding decision and easy to mis-spell on someone else's behalf.

**Notes**:
- Migration `20260503120000_add_go_live_and_queued_invites`: `ALTER TYPE InvitationStatus ADD VALUE 'QUEUED' BEFORE 'PENDING'`; `Tenant.goLiveAt` backfilled from `createdAt` for already-ACTIVE tenants; `OnboardingProgress.subscriptionAttestedAt` backfilled from `completedAt` where set.
- Tests: 273/273 (was 247, +26 new across [slug-route](src/lib/__tests__/slug-route.test.ts), [subscription-route](src/lib/__tests__/subscription-route.test.ts), [invitations-queued](src/lib/__tests__/invitations-queued.test.ts), [go-live-route](src/lib/__tests__/go-live-route.test.ts); plus placeholder-slug assertion added to acquisition test).
- Outbound stubs are best-effort *after* the go-live transaction commits — durability of the status flip beats outbound atomicity.
- Slug regex: `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$`, no `--`, 16 reserved words. Inputs are lowercased before validation (so "Bad-Slug" normalises to "bad-slug" and is accepted).


## 2026-05-03 — Sign-in gate moved off legacy `active` boolean (ONBOARDING admins were locked out)

**Status**: decided

**Context**: Wullie hit "Invitation already used or revoked" 409 after submitting
the accept-invite form for a freshly approved test club. Tracing showed the
POST succeeded (membership ACTIVE, invitation ACCEPTED), then the auto-signin
silently failed because [src/lib/auth.ts](src/lib/auth.ts) `authorize()` was
gating on `user.tenant.active`. ONBOARDING tenants have `active=false`, so the
brand-new tenant admin couldn't sign in to drive the onboarding wizard. The
re-submit then hit the 409. Same conceptual bug as the impersonation gate
fixed earlier today — legacy `active` mirror used where `status` is the
authoritative field.

**Decision / outcome**:
1. `authorize()` now blocks only `SUSPENDED` and `CHURNED` tenants. ACTIVE
   and ONBOARDING both allowed (LEAD shouldn't have users; treated as
   allowed-by-default since the disciplinary list is authoritative).
2. Invite-accept page recovers from 409: if the user re-submits an
   already-accepted invitation with the same password, we attempt sign-in
   with that password. If it works, redirect to `/dashboard`; otherwise show
   a "this invitation has already been accepted, please sign in" hint.
3. New test file [src/lib/__tests__/auth-status-gate.test.ts](src/lib/__tests__/auth-status-gate.test.ts)
   asserts: ACTIVE allowed, ONBOARDING allowed, SUSPENDED blocked, CHURNED
   blocked, wrong password blocked.

**Notes**: 247/247 tests passing.


## 2026-05-03 — Orthogonal-role enforcement on tenant detail page & PATCH

**Status**: decided

**Context**: Logged in as PLATFORM_ADMIN (no impersonation), the
`/dashboard/platform/tenants/[id]` page still showed an "Edit" button that let
the admin mutate tenant-plane fields (branding, hours, season). That violated
the orthogonal-role principle codified in `src/lib/roles.ts`: PLATFORM_ADMIN
has zero implicit tenant powers. Also discovered the impersonation start
endpoint blocked any tenant with `active=false`, which excluded ONBOARDING
tenants — exactly when a platform admin most needs to help.

**Decision / outcome**:
1. PATCH `/api/admin/tenants/[id]` now partitions request fields into two
   planes:
   - `TENANT_PLANE_FIELDS`: name, brandColor, logoUrl, locale, season*, hours,
     latitude, longitude. Requires **effective** TENANT_ADMIN of *this* tenant
     (so a non-impersonating PLATFORM_ADMIN gets 403
     `PLATFORM_ADMIN_NO_CONTEXT`).
   - `PLATFORM_PLANE_FIELDS`: status, active. Requires real, non-impersonating
     PLATFORM_ADMIN.
   - Mixed-plane updates are rejected with 400.
2. Platform tenants/[id] page rewritten:
   - All tenant content displayed read-only.
   - "Impersonate to edit" button (with reason input) calls
     `/api/platform/impersonation`, then `update({ actingAs })`, then routes
     to `/onboarding` (if status=ONBOARDING) or `/{slug}` otherwise.
   - Separate platform-plane lifecycle controls for Activate / Suspend /
     Reactivate / Mark churned (status changes only).
3. Impersonation start now allows status ∈ {ACTIVE, ONBOARDING}; only blocks
   SUSPENDED and CHURNED. Rationale: ONBOARDING is precisely when platform
   admin assistance is most useful.

**Rationale**: Without (1) the API would silently accept a non-impersonating
platform admin's writes, undoing the audit story. Without (2) the UI offered
an action that would 403, and there was no path to do the right thing.
Without (3) impersonation couldn't reach the new tenants the wizard was
built for. All three fixes are required to keep the model coherent.

**Notes**: Updated `impersonation.test.ts` fixture: the "inactive" tenant now
also sets `status: SUSPENDED` so the 400-block test still asserts the
intended behaviour under the new status-based gate. 242/242 tests passing.


## 2026-05-03 — Onboarding wizard, multi-club switcher, test coverage

**Status**: decided

**Context**: Phase 3 (onboarding wizard) needed to land before new tenants
in ONBOARDING status had any UI to drive themselves through. Reading-code
sweep also needed at least a starter so the multi-club Identity/Membership
model could actually be exercised end-to-end.

**Decision / outcome**:
1. Added `OnboardingProgress` model (one row per tenant) — chapter index +
   completedChapters JSON array. Backfill marks all ACTIVE tenants as
   chapter-8-complete so they don't get hijacked into the wizard.
2. 8-chapter wizard at `/onboarding`: about, where, hours, greens, people,
   knowledge, features, summary. Each chapter writes through to its real
   domain model (no draft state).
3. `/dashboard` redirects TENANT_ADMIN of an incomplete tenant to /onboarding.
4. Broadened `/api/admin/tenants/[id]` PATCH and `/flags` to allow
   TENANT_ADMINs on safe-field subsets (branding, hours, location, and a
   whitelist of toggleable flags). Platform-only fields (slug, status,
   gated flags) stay PLATFORM_ADMIN.
5. New `/api/onboarding/invite` lets TENANT_ADMINs invite people directly
   from the wizard's "Your people" chapter. Reuses User-by-email and creates
   PENDING Membership + UserInvitation just like the platform approval flow.
6. **Reading-code sweep starter**: new `src/lib/memberships.ts` with
   `getActiveMembershipsForUser`, `pickPrimaryMembership`,
   `resolveActiveContext`. Wired into `src/lib/auth.ts` JWT callback so the
   active tenant is now resolved from memberships at sign-in (multi-club
   users land in their lowest-createdAt active membership). Added
   `activeTenantId` to JWT and session. New `/api/auth/memberships` and
   `/api/auth/memberships/active` (guard endpoint). Dashboard topbar now
   renders `<TenantSwitcher>` for users with ≥2 active memberships.
7. **Tests added** (4 new files, 23 new tests, all passing):
   - `outbound.test.ts`: template interpolation, missing-var fallback,
     stub message creation, social platform capture
   - `acquisition-route.test.ts`: full lead → approve → invite → accept
     happy path; duplicate-approval rejection; unknown-token 404
   - `onboarding-route.test.ts`: progress GET/POST/upsert, completedAt
     transition, range validation, RBAC
   - `memberships.test.ts`: helpers cover multi-club + suspended-fallback
     + orphan-user cases
8. `User.tenantId` retained as denormalised mirror — readers across the
   codebase still work unchanged. The new switcher updates the JWT but
   does NOT mutate `User.tenantId` (intentional: that field will eventually
   be dropped, not toggled).

**Rationale**: Wizard had to be additive because the tenants/flags PATCH
broadening was the smallest reading-code change that unlocked the whole
chapter set. Going further (rewriting all `User.tenantId` reads) would
have been weeks of churn for no immediate user-visible gain — the JWT
resolver gives us the multi-club promise today; the rest can sweep when
real demand comes from a feature that actually needs it.

**Notes**:
- Final test run: 20 suites, 242 tests, all green. Non-test TypeScript
  errors: 0. (Pre-existing test-file `@types/jest` warnings unrelated.)
- `Chapter5People` chapter calls a NEW endpoint `/api/onboarding/invite`
  rather than reusing `/api/admin/applications/[id]/approve` — the
  approval path provisions a tenant, the wizard path adds people to an
  existing tenant.
- Switcher reload-on-switch is a sledgehammer (full `window.location.reload`)
  but correct: SSR pages would otherwise still see the old tenantId.
  Smart-refresh is a Phase 4 polish job.

**Open follow-up** (not blocking):
- Sweep remaining `User.tenantId` reads in dashboard pages to use the
  active membership context. None of them are wrong today (mirror is
  always in sync), but they'd block multi-tenant impersonation analytics.
- Onboarding wizard has no tests for the React components themselves —
  only the API endpoints. RTL + jsdom would cover that.

## 2026-05-02 — Agent API surface complete; deferred CRUD parity

**Status**: decided

**Context**: Building out the API endpoints needed by the agent dashboard UI.
Question was how complete a CRUD surface to expose in this pass.

**Decision / outcome**: Shipped a minimal-but-sufficient set:
- Per-agent config: GET + PATCH (no DELETE — config rows are upserted)
- Runs: GET only (runs are created by the run trigger; no need to mutate)
- Knowledge: full CRUD (GET/POST/PATCH/DELETE)
- Maintenance history: GET + POST (no PATCH/DELETE — historical record is append-only)
- Task interactions: GET only (writes happen inside agents via BaseAgent.recordDecision)

**Rationale**: Keeps surface area small. Append-only semantics for runs and history
match how staff would think about them (you don't "edit" what an agent did or what
work happened — you record corrections via feedback or new history entries).
Knowledge needs full CRUD because it's the user-tunable lever for agent behaviour.

## 2026-05-02 — Agent CLI scripts via HTTP, not direct invocation

**Status**: decided

**Context**: Needed `npm run agent:detect/triage/all` scripts to drive agents
from cron. First attempt was a ts-node script that imported `getAgent` directly
from `src/lib/agent/registry.ts`.

**Decision / outcome**: Replaced with `scripts/run-agent.mjs` (plain Node), which
POSTs to `/api/agent/run` using `AGENT_SECRET` bearer auth and the `?tenantId=`
query param. Discovers tenants via Prisma when no explicit tenant is given.

**Rationale**:
- The agents import `@/lib/prisma` (Next.js path alias) and other module-resolver
  conventions that don't survive being executed outside the Next runtime.
- HTTP path mirrors how a real cron will hit the deployed server, so the script
  is closer to production reality.
- AGENT_SECRET auth is already implemented in the run route — reuses existing
  auth surface instead of inventing a CLI-only path.
- Falls back to assuming the `--tenant` arg is an ID when DATABASE_URL is unset,
  so cron environments don't need DB access.

## 2026-05-02 — Agent dashboard nav for MAINTENANCE+, not TENANT_ADMIN-only

**Status**: decided

**Context**: Where to put the agent dashboard link in the sidebar.

**Decision / outcome**: Show `🤖 Agents` for MAINTENANCE and TENANT_ADMIN
(effective role). Knowledge management page is gated TENANT_ADMIN-only on the
API side; dashboard is read-and-feedback for any maintenance staffer.

**Rationale**: Maintenance staff are the people receiving auto-assigned tasks
and who know whether a triage decision was right. Keeping the feedback loop
close to them improves data quality. Knowledge curation is a higher-trust
operation so stays with admins.

## 2026-05-02 — Build correct first, plant traps deliberately

**Status**: decided

**Context**: User noticed an empty knowledge list during impersonation and
asked whether it was a planted QE trap. It wasn't — it was a real bug from
mixing real role and effective context in `/api/agent/knowledge`. The agent
GET handler used `session.user.role !== "PLATFORM_ADMIN"` for visibility
scoping, so an impersonating platform admin got the unscoped platform view
instead of the tenant view they should have seen.

**Decision / outcome**:
1. Fixed the leak: visibility scoping now keys off effective context
   (`session.user.role === "PLATFORM_ADMIN" && !session.user.actingAs`),
   matching the pattern used by `assertEffectiveRoleOrFail`. Mutate routes
   for GLOBAL/REGIONAL knowledge now also call `rejectIfImpersonating()` so
   an impersonating platform admin cannae mutate platform-plane rows whilst
   acting as a tenant.
2. Going forward: build features correctly, then add planted bugs only on
   stable surfaces and only when listed in the canonical bug manifest at
   `.cache-loader/build-manifest.md`. Mixing in-flight defects with planted
   ones makes signal vs noise impossible — you cannae tell whether a future
   bug was mine or yours.
3. The OpenWeatherMap-vs-Open-Meteo split in the agent framework was added
   off my own back during the build. User confirmed they like it as a trap;
   added it to the manifest as sanctioned bug #8.

**Rationale**: A QE training app needs clear provenance. If a defect isn't
in the manifest it's a real bug; if it is, it's training material. Anything
in between erodes trust in the exercise.

**Notes**: Audited all other agent routes (decisions, runs, config,
maintenance history, task interactions). They all use `resolveTenantId()`
which honours impersonation correctly, so the leak was confined to the
knowledge routes.

## 2026-05-03 — Identity / Membership split (Option A) — additive migration

**Status**: decided

**Context**: Two real-world cases broke the single `User.tenantId + role`
model: (a) club members who belong to multiple clubs needing one login and
holistic views; (b) professional greenkeepers who service N clubs as
contractors with no "primary" club. The single-tenant assumption baked
into `User` couldn't model either.

**Decision / outcome**: Adopted Option A — `User` becomes a global
identity, joined to tenants via a new `Membership` model
(`role × kind × status`). `PLATFORM_ADMIN` becomes a separate
`User.isPlatformAdmin` boolean (orthogonal flag). Migration is **additive
only** — `User.tenantId` and `User.role` are kept as denormalised mirrors
of the user's primary membership so existing reading code keeps working
unchanged. A follow-up phase will sweep readers and eventually drop the
back-compat columns.

`Membership.kind` enum (`MEMBER | STAFF | CONTRACTOR | VOLUNTEER`)
shipped from v1 to model the contractor case correctly. Federations stay
orthogonal — no `FEDERATED` enum slot on `TenantStatus`.

**Rationale**: Option A pays migration cost once and gets a clean model.
Option B (primary + secondary) makes one club artificially special, which
mispresents the contractor relationship. The additive-only approach
de-risks: every API still works on day 1; only new features (lead
provisioning, invitations) write to the new tables. Sweep-of-readers is
a separate cleanup whose risk scales with willingness, not deadline.

**Notes**:
- Migration `20260502231713_add_membership_lifecycle_outbound` includes
  backfill SQL: `Membership` rows from existing `User.tenantId`,
  `User.isPlatformAdmin = TRUE` for `role=PLATFORM_ADMIN`,
  `Tenant.status` derived from `active`.
- One wrinkle from the backfill: agent system users (`detector@agent.system`,
  `triager@agent.system`) were seeded with `role=PLATFORM_ADMIN` so they got
  `isPlatformAdmin=true`. Side effect: they receive every "new lead" admin
  notification stub. Harmless in stub mode but should be addressed when
  agent system users are cleaned up — they should probably be a separate
  user kind that doesn't carry platform admin privilege.

## 2026-05-03 — Country sets jurisdiction; feature flag chooses to use it

**Status**: decided

**Context**: Followup on the `Tenant.country` decision earlier today.
Question: among UK bowling clubs, who actually uses the Charity Accounts
module? Not all of them are registered charities — there's a real
distinction between several common UK club legal forms, and conflating
"based in the UK" with "needs to file with the Charity Commission" would
be wrong.

**Decision / outcome**: Two-axis gate, both required to use the feature:
1. **`Tenant.country ∈ {GB, NI}`** — set by PLATFORM_ADMIN only; a fact
   about the club's jurisdiction (not a choice)
2. **`charity` feature flag = on** — TENANT_ADMIN-controlled (or
   onboarding-wizard-driven later); a choice about *whether to use* the
   module

A UK club is not forced into the module by virtue of being UK-based.
Concrete examples of legitimate `country=GB, charity=off` tenants:
- **CASC** (Community Amateur Sports Club) — reports to HMRC under the
  CASC scheme, not the Charity Commission. Different reporting regime
  entirely; charity-mode would actively mislead them.
- **Private members' club / company limited by guarantee** — files at
  Companies House with statutory accounts, not a TAR.
- **Unincorporated association below charity registration thresholds**
  — keeps internal books, no external filing obligation.
- **Registered charity but uses an external bookkeeper/accountant** —
  the trustees may simply not want the module duplicating what their
  accountant does in QuickBooks/Xero.

**Rationale**: Country answers "what's possible legally"; the flag
answers "what does this tenant want". Keeping them separate prevents:
- Forcing the wrong reporting model onto CASCs (a real legal-compliance
  risk if it confused trustees about their actual obligations)
- Cluttering the dashboard with a charity sidebar entry for non-charity
  clubs
- Coupling jurisdiction-introduction to feature-rollout — when we add a
  new country to the enum, we don't automatically opt every tenant
  there into every jurisdiction-coupled feature

**Notes**:
- Same shape will work for future jurisdiction-coupled features: Gift
  Aid (GB-only, but only for registered charities — same two-axis
  gate, possibly same `charity` flag), VAT/MTD (GB-only, but only for
  VAT-registered tenants — new flag), etc.
- Help-centre article should explain the CASC vs charity distinction
  clearly when the feature lands; common point of confusion.
- The platform-admin UI for toggling the flag should refuse the toggle
  with a clear error if `country ∉ {GB, NI}`, rather than silently
  toggling a flag that does nothing.

## 2026-05-03 — `Tenant.country` is a general-purpose jurisdiction hook

**Status**: decided

**Context**: Charity Accounts is the first feature to need country-level
gating (UK/NI only). The temptation was to add a charity-specific column
(e.g. `Tenant.charityRegulator`) since that's the only consumer right now.
But jurisdiction-coupled features are going to keep coming up — Gift Aid
claims, VAT thresholds, GDPR vs CCPA cookie rules, US 990 forms, ACNC
reporting, Garda vetting workflows for ROI clubs, etc. — and each one
adding its own column would scatter the same concept across the schema.

**Decision / outcome**:
1. Add `Tenant.country` as a **first-class enum on the tenant**, not a
   charity-feature field. Initial values: `GB | NI | OTHER`, defaulting
   to `OTHER` for existing rows on migration.
2. Future jurisdictions are added to the enum as features that need them
   land — never speculatively. So when someone wants Gift Aid for a US
   charity-equivalent, we add `IE` or `US` to the enum at that point.
3. Charity Accounts is the first consumer (`country ∈ {GB, NI}` plus the
   `charity` feature flag both required), but the field itself is
   feature-agnostic. Any future jurisdiction-coupled feature gates on
   `country` the same way — typically alongside its own feature flag.
4. Country and `locale` stay **orthogonal**. A Welsh-speaking club has
   `country=GB, locale=cy`. A French-speaking ROI club would be
   `country=IE, locale=fr` (when IE lands). Don't conflate them.
5. The country value is editable by **PLATFORM_ADMIN only** (via the
   tenant edit page); TENANT_ADMIN cannot change it themselves.

   *Why this matters*: country isn't a cosmetic preference — it
   determines which legal/regulatory regime applies to the tenant. A
   TENANT_ADMIN flipping their own country would let them:
   - **Bypass jurisdictional gating**: e.g. a tenant outside the UK
     toggling to `GB` to unlock Charity Accounts (or, later, Gift Aid
     reclaim flows) they're not legally entitled to use
   - **Misrepresent compliance posture**: e.g. switching to dodge
     GDPR-vs-other privacy rules, or to claim eligibility for a tax
     scheme they don't qualify for
   - **Corrupt audit history**: prior `AuditEvent` rows reference a
     country context that no longer matches the tenant; investigations
     become muddled
   - **Trigger silent data-shape changes**: feature flags / category
     seeds / report templates may switch underneath users mid-session

   PLATFORM_ADMIN edits go through the existing tenant PATCH path, are
   audited (`tenant.country.changed` action with before/after in `meta`),
   and require the platform admin to be acting in their own context (not
   impersonating a tenant — `rejectIfImpersonating()` applies, mirroring
   the platform-plane mutation pattern from the agent knowledge routes).

   Migration path for an existing tenant discovering they were
   misclassified (e.g. created with default `OTHER`, actually `GB`):
   tenant raises a support request → platform admin verifies (charity
   number lookup, address, etc.) → platform admin updates → audit row
   captures the change with reason in `meta.notes`. No self-service path,
   ever.

**Rationale**: Schema fields representing the real world should match the
real world's shape, not the shape of whichever feature noticed them
first. Country is a genuine property of a club — it has one — and it
unlocks compliance/regulatory/integration choices that future features
will keep needing. Adding it now, generically, costs nothing extra
(one column + a backfill) and prevents the death-by-a-thousand-columns
that "shoehorn it into the feature that needs it" produces.

**Notes**:
- Out-of-scope today but anticipated future consumers: Gift Aid (GB),
  VAT/MTD thresholds (GB), Garda vetting (IE), GDPR-vs-other privacy
  text variants, regulator-specific report exports, jurisdiction-coupled
  payment provider availability, time zone defaults.
- Does not replace `Tenant.locale` (UI language). Does not replace
  `Tenant.latitude/longitude` (geocoding). It's purely the regulatory /
  jurisdictional axis.

## 2026-05-03 — Charity Accounts feature is country-gated (UK/NI only)

**Status**: decided

**Context**: Planning a Charity Accounts module (Receipts & Payments ledger,
TAR wizard, Open Banking import, receipt OCR). The platform is a global
multi-tenant SaaS — clubs in any country can sign up — but charity reporting
rules are jurisdiction-specific and the regulators (Charity Commission for
England & Wales, OSCR for Scotland, CCNI for Northern Ireland) all use
different category taxonomies, different TAR templates, and different
submission portals. Building a one-size-fits-all charity module would either
be wrong everywhere or balloon to an unmaintainable matrix.

**Decision / outcome**:
1. The Charity Accounts module is **gated by `Tenant.country` AND a
   per-tenant `charity` feature flag**. Both must be true for any charity
   route, API, nav entry, or UI to surface.
2. **v1 supports `country ∈ {GB, NI}` only** — covering CC E&W, OSCR, and
   CCNI. Other jurisdictions (Republic of Ireland Charities Regulator, IRS
   501(c)(3), Australian ACNC, Canadian CRA, etc.) are out of scope and
   their tenants will see a "not supported in your region" notice if a
   platform admin tries to enable the flag.
3. **`Tenant.country` is a new enum** (`GB | NI | OTHER`, defaulting to
   `OTHER` for all existing tenants on migration). Future jurisdictions
   added to the enum as their own implementations land — never as a
   speculative blanket "EU" or "international" toggle.
4. The R&P category seed (`src/lib/charity/categories.ts`) is keyed by
   regulator (`CC_EW | OSCR | CCNI`), with `CharitySettings.regulator`
   selecting which set applies to a given tenant.
5. A small helper `assertCharityEnabled(tenantId, country)` is the single
   gate used by every charity API route, mirroring the existing
   `isFeatureEnabled` pattern but layered with the country check.

**Rationale**: Charity accounting is one of the most jurisdiction-coupled
domains there is — categories, thresholds, formats, and even the definition
of "charity" differ. Trying to build a universal module would force
compromises that satisfy no regulator. Gating by country keeps the feature
honest about its scope, prevents misuse by clubs outside supported regions,
and creates a clean expansion point: when we want to support, say, Republic
of Ireland, we add `IE` to the enum, ship its category seed and TAR
template, and the existing gate logic just works.

**Notes**:
- Locale (`Tenant.locale`) and country are orthogonal — a Welsh-language
  tenant with `country=GB` is fully supported; the TAR PDFs will be
  English-only in v1 (Welsh translations are a follow-up).
- The country field is also a useful hook for other future
  jurisdiction-specific features (e.g. UK Gift Aid, US 990 forms) without
  having to retrofit the schema.
- Captured in plan at `/memories/session/plan.md` (P0 foundations).

## 2026-05-03 — Charity Accounts: Open Banking ships behind a stub provider

**Status**: decided

**Context**: Open Banking (PSD2 AISP feed) is the cleanest way to import
bank transactions for the charity ledger. GoCardless Bank Account Data
(formerly Nordigen) is the right real provider — free tier, AIS-only, 99%
UK bank coverage. But wiring it up requires registering an organisation
with GoCardless, generating secret IDs, and going through their KYC, which
is friction we don't want to gate the build on.

**Decision / outcome**:
1. Build the **full P4 feature** (connect flow, sync endpoint, model
   layer, reconciliation UI, 90-day re-consent reminders) **against a
   stub provider** behind an interface (`src/lib/charity/banking/provider.ts`),
   selected by env (`CHARITY_BANKING_PROVIDER=stub | gocardless`,
   defaulting to `stub`).
2. The stub mirrors the `outbound.ts` honest-stub pattern: deterministic
   fake accounts, plausible auto-generated transactions (member subs,
   utilities, occasional one-offs), seeded by request shape so re-syncs
   are idempotent. An internal `/dashboard/charity/banking/stub-consent`
   page mocks the bank-consent screen.
3. A yellow "Demo bank connection" banner shows on every banking page
   when `provider.isReal === false` so the stub data is never mistaken
   for real bank data.
4. The real GoCardless implementation is a separate, deferrable phase
   (P4b) — write `gocardless.ts` against the same interface, set the env,
   smoke against their sandbox bank. If the abstraction is right, no
   other code changes.

**Rationale**: Same playbook as outbound messaging — build the full
feature behind an honest stub, swap in the real provider later. Keeps the
build unblocked, gives QE a deterministic environment, makes the demo
story coherent, and de-risks the abstraction (we discover any leaky bits
during the stub phase, not during a sandbox-credential scramble).

**Notes**: Abstraction also keeps the door open for TrueLayer or Plaid
if GoCardless ever changes terms.

## 2026-05-03 — Outbound messaging stubbed across all channels

**Status**: decided

**Context**: Need email for password reset, invitations, lead
acknowledgements, etc. User's preference: no real delivery in v1, but
the stub must support email + SMS + social and be inspectable so QA
can verify content and format.

**Decision / outcome**: Built `src/lib/outbound.ts` with a single
`sendOutbound({channel, to, subject?, template, data, ...})` API that
writes `OutboundMessage` rows. Templates live on disk under
`content/messages/{channel}/{name}.{txt|html}` with simple `{{var}}`
interpolation. Email gets a wrapping HTML layout. Inspector UI at
`/dashboard/platform/outbound` shows channel-specific previews:
side-by-side email HTML/text in iframe, SMS phone mockup with char count,
social card mock per platform. "Mark as sent manually" button supports
out-of-band delivery during training.

**Rationale**: Stub is honest about what it is. Inspector lets QE verify
template rendering without needing a real provider. Same call signature
across channels means swapping in Resend/Twilio/Meta later changes only
the dispatch implementation.

**Notes**: Templates cached only in production (NODE_ENV check) so
template edits show up immediately in dev. Missing template variables
render as `[varname]` for visibility instead of silently empty.


## 2026-05-06 — i18n foundation: `next-intl`, tenant-locale, no URL prefix (`#i18n`)

**Status**: decided

**Context**: Platform supports bowling clubs globally (bowling is growing fast
in Asia). Need multiple language support. `#i18n` was deferred at Phase 9;
promoted to Next after scoping decisions. Key question was routing strategy:
path prefix (`/cy/dashboard`), cookie, or tenant-setting-only.

**Decision / outcome**: Ship `next-intl` v4 with tenant-setting-only locale
routing. No URL locale prefix — language follows `Tenant.locale` (already in
schema). Middleware syncs a `locale` cookie from the JWT so
`getRequestConfig()` can read it server-side. Welsh (cy) is the first
non-English locale. Machine-generated translations acceptable for local dev;
professional translator required before production.

**Rationale**:
- Tenant-setting routing is simplest: no middleware rewrites, no link
  generation changes, no SEO implications (club sites aren't indexed by
  locale). Language is a club-level decision, not a per-user/per-URL one.
- `next-intl` was already named in the roadmap; it has mature App Router
  support, ICU message format, and works in both server and client components.
- Welsh first because UK bowling club geography includes bilingual Welsh clubs
  (Welsh Language Standards apply to public-facing services).
- Rejected: path-prefix routing (over-engineered for a setting that changes
  once per club), per-user locale override (deferred to future if demand
  emerges).

**Notes**: Phase 1 (infra) shipped in this commit. Plan for remaining phases
lives at `parked-plans/i18n.md`. CJK/Asian locale UI resilience (word-break,
font stack) is not needed yet — flagged as future consideration when the first
Asian locale is requested.

## 2026-05-09 — Permission groups + federation v1 shipped (`#permission-groups`)

**Status**: decided

**Context**: The orthogonal role model (PLATFORM_ADMIN / tenant ladder) was
reaching its limit — clubs need committee-shaped access control ("Events
Committee can manage events but not greens") and cross-club booking requires
a federation-level permission gate. A 6-phase plan (C1–C6) was refined on
2026-05-07 and implemented on `feature/permission-groups`.

**Decision / outcome**: Ship all six phases as a single feature branch merge.

- **C1** — Permission enum (43 values across 14 domains), PermissionGroup /
  PermissionGrant / GroupMember models, Federation / FederationMembership /
  FederationInvite models, built-in group seeding.
- **C2** — `assertPermissionOrFail` dual gate (parallel to existing
  `assertEffectiveRoleOrFail`). TENANT_ADMIN bypass implicit. No caching v1.
- **C3** — Groups CRUD UI (8 API routes, 2 dashboard pages, checkbox
  permission grid by domain).
- **C4** — Federation lifecycle API (8 routes, feature-flagged per tenant).
  Guardrails: max 3 federations/club, max 10 clubs/federation, 5 invites/day,
  14-day invite expiry.
- **C5** — Cross-club booking via `targetTenantId` on POST /api/bookings.
  Validates common active federation + `federation_book_at_partners` permission.
  Cross-club clash detection (same slot / adjacent slot) with confirm-to-proceed.
  Provenance via `Booking.bookedByTenantId` + `Booking.federationId`.
- **C6** — Federation UI (list + detail pages), sidebar link (flag-gated),
  settings hub card.

**Rationale**:
- Permission groups are additive — existing role gates are unchanged. Groups
  are opt-in; existing users keep working via role checks. No migration of
  existing routes (`#retire-role-mode` deferred).
- Federation is flat (no hierarchy) and invitation-based (club-to-club, not
  user-to-user). Federation invites use their own model, not `UserInvitation`.
- Cross-club booking uses soft warnings (confirm-to-proceed), never hard
  blocks — aligns with the "club-friendly" design principle.
- `permission-defs.ts` split from `permissions.ts` to keep client components
  free of Prisma/Node built-in imports (build error discovered during C3).

**Notes**: `#federations` tag in ROADMAP deferred to `#permission-groups` C4–C6.
476 tests green (started at 416; added 47 across C2–C5).

---

## 2026-05-09 — #funding-applications: Phase 1 scope and data model

**Status**: decided

**Context**: Clubs (especially small charities) routinely apply for grants
from Sport England, National Lottery Community Fund, Bowls England
development grants, and local authority sport funds. The platform already
holds the data these applications need (TAR narratives, financials, org type,
membership counts) but has no way to surface grant opportunities or help
clubs draft applications. The permission-groups work (C1) explicitly
anticipated a "Funding Committee" custom group and called out funding
applications as a future consumer.

**Decision / outcome**: Three-phase feature on `feat/funding-applications`:

1. **Phase 1 (S)** — Schema, permissions, feature flag, CRUD API, tracking
   UI. Three new models: `FundingOpportunity` (platform-level catalogue),
   `FundingApplication` (per-tenant), `FundingResponse` (per-application
   question/answer pairs, AI-draftable). Two new permissions:
   `funding_view`, `funding_manage`. Feature-flagged via `"funding"` key
   (no country restriction, unlike charity).
2. **Phase 2 (S)** — Grant discovery: seed curated UK opportunities,
   eligibility matching (org type, country, locality), deadline awareness.
3. **Phase 3 (M)** — AI-assisted drafting: `FundingApplicationAgent`
   extending `BaseAgent`, reuses TAR context data keys, emits
   `FUNDING_APPLICATION_DRAFT` proposals via the agent inbox.

**Rationale**:
- `FundingOpportunity` is platform-level (shared across tenants) so clubs
  don't each re-enter the same Sport England grant.
- One application per opportunity per tenant (`@@unique`) simplifies
  tracking; clubs update status on the existing record rather than creating
  duplicates.
- New `funding` i18n namespace (not `charity`) — funding applications are a
  separate domain even though they consume charity data.
- Permissions assigned to TENANT_ADMIN via Administrators built-in group;
  clubs can subdivide via custom "Funding Committee" groups.
- Phase 3 reuses TAR context data keys — same club data that feeds TAR
  narratives is exactly what grant applications need.

**Addendum (same session)**: Reworked during review — original design
forced all opportunities through a platform-curated catalogue, which was
too restrictive. Clubs need to add their own opportunities they've found
independently.

Changes: `FundingOpportunity.tenantId` (nullable — null = platform,
set = tenant-created). New `FundingQuestion` model linked to opportunity
(defines the application form questions). `FundingResponse` now links to
`FundingQuestion` via optional `questionId` (freeform still works via
`questionLabel` when `questionId` is null). Dropped `@@unique([tenantId,
opportunityId])` on `FundingApplication` — clubs may re-apply or track
multiple rounds. This also sets up Phase 3 agent-assisted question
extraction (scrape questions from a pasted URL/PDF).


## 2026-05-10 — #funding-applications: all three phases shipped

**Status**: decided / shipped

**Context**: Phases 2 and 3 completed in the same session as Phase 1.

**Decision / outcome**:
- **Phase 2** — 9 curated UK bowling/sport grants seeded via idempotent
  `scripts/seed-funding-opportunities.ts`. Rule-based eligibility scorer
  (`src/lib/funding/eligibility.ts`) ranks opportunities 0–100 by country,
  org-type, and deadline proximity. Recommended badges + deadline countdown
  pills on the overview grid.
- **Phase 3** — `FundingApplicationAgent` extends `BaseAgent`, aggregates
  tenant context (members, events, financials, charity settings), drafts
  answers for unanswered questions via LLM, emits
  `FUNDING_APPLICATION_DRAFT` proposals. Committer upserts
  `FundingResponse` with `source=AI_APPROVED` + `agentProposalId` audit
  link. 8 common question templates as fallback when an opportunity has no
  per-opportunity `FundingQuestion` rows. Inline draft review on the
  application detail page (generate button, approve/reject per-draft).
- Dev seed now enables all feature flags by default.

**Rationale**: Scoring is deliberately naïve (rule-based, not ML) — good
enough to surface relevant grants and demonstrate the pattern. The agent
reuses the same context-aggregation approach as the TAR wizard, confirming
the data-layer investment pays off across features.

**Notes**: Branch `feat/funding-applications`, commits d068bf6 (P1),
a18b68c (P2), 7a0cc9f (P3).

## 2026-06-15 — #funding-applications: multi-round support + consolidated status view

**Status**: decided / shipped

**Context**: Post-ship review found three gaps: (1) the UI showed a static "Applied"
label that permanently blocked re-applying even after withdrawal or rejection —
despite the DB never having had a uniqueness constraint on `(tenantId, opportunityId)`;
(2) there was no unified per-awarding-body view showing eligibility + latest status
together; (3) the PATCH route at `/api/funding/applications/[id]` had a bug where
it built a `data` object but called `findFirst` instead of `update`, silently
discarding all status/amount changes including Withdraw.

**Decision / outcome**:
- **PATCH bug fixed**: `prisma.fundingApplication.update({ data })` replaces the
  erroneous `findFirst`. Withdraw (and every other status change) now persists.
- **Multi-round un-gated**: the overview page now computes status-awareness per
  awarding body from the enriched `GET /api/funding/opportunities` response. An
  "Apply" / "Re-apply" / "In progress →" action is shown based on whether the
  latest application round is terminal or active. No DB change needed.
- **Consolidated view**: the separate "Your Applications" list and "Opportunities"
  catalogue are merged into one sorted list keyed by awarding body. Each row shows
  eligibility badge, latest status, round count, deadline, max amount, cadence info,
  and the status-aware action.
- **Advisory cadence (two-value, stricter wins)**:
  - `FundingOpportunity.reapplyIntervalMonths Int?` — funder-published cadence,
    seeded for known funders (National Lottery: 12mo, Bowls England: 12mo; others null).
  - `FundingOpportunityPref { tenantId, opportunityId, reapplyIntervalMonths, @@unique }` —
    tenant override. Platform opportunities are shared across tenants so the override
    cannot live on `FundingOpportunity`; a per-tenant pref model is the clean separation.
  - Effective interval = `max(funderInterval, tenantInterval)` (stricter of the two).
  - Warning appears inline on the overview row and as a `cadenceWarning` string in
    the POST `/api/funding/applications` response body (never a 4xx — advisory only).
  - Tenant sets override inline on each awarding-body row via new
    `PATCH /api/funding/opportunities/[id]/pref`.
- **WIP schema debt fixed**: the Workflow Engine models added by a parallel session
  had four broken back-relations (`currentRuns`, `workflowTransitionLogs` duplicated
  on wrong model, `performedBy` missing User back-relation, `currentStage` missing
  relation name). Fixed as collateral to unblock the migration.

**Rationale**:
- No uniqueness constraint was ever added (deliberate, from Phase 1 addendum).
  The DB was always ready; only the UI needed updating.
- Two-value cadence with "stricter wins" because the club often knows their
  relationship with a funder better than the published rules state. Neither
  value enforces — platform respects club autonomy.
- `FundingOpportunityPref` over stashing on `FundingApplication`: cleaner
  separation of preference (persistent) from application history (transactional).



**Status**: decided

**Context**: The approved plan (memory-tool plan.md) called for a
PLATFORM_ADMIN-only enterprise MI dashboard with curated KPIs across
multiple domains, daily snapshots, and no self-serve builder. For v1 we
query live data rather than materialised snapshots — good enough for the
current tenant count and avoids a new cron job.

**Decision / outcome**: Single API endpoint at
`/api/admin/reports/insights` returning 9 KPI domains: adoption, revenue
(with country breakdown), churn, operations (tenant leaderboard),
agents (including detector chat→task conversion rates), federation &
funding, onboarding pipeline (application→activation time by country),
language/locale distribution (translation ROI), and feature usage (by
tenant/country). Tabbed dashboard at `/dashboard/platform/insights`.

**Rationale**: Reuses `getRevenueReport()` / `getChurnReport()` from
billing.ts rather than duplicating queries. Revenue-by-country and
feature-usage-by-country use raw SQL joining Tenant.country. Onboarding
pipeline derives time-to-activate from `Tenant.createdAt→goLiveAt` and
application review time from `TenantApplication.createdAt→reviewedAt`.
Detector agent KPIs filter by `AgentDefinition.slug = "detector"` and
`AgentProposal.kind = "MAINTENANCE_TASK_CREATE"`. Locale distribution
shows whether cy translations are earning their keep.

**Notes**: Branch `feat/business-insights`. Tenant-level analytics
(bookings/members/operations) shipped in prior commits on the same
branch. Materialised daily snapshots deferred to v2 if query latency
becomes an issue at scale.



## 2026-06-16 — #funding-applications: per-response AI refine + shared `funding/ai.ts`

**Status**: decided / shipped

**Context**: Drafting funding answers previously had one mode — the batch
`FundingApplicationAgent` proposing whole-application drafts through the
propose-not-publish proposal-inbox flow. Clubs wanted to iterate on a *single*
answer in place ("make this more formal", "shorten it") without regenerating the
whole application or routing through the inbox. The agent's context-gathering
logic was also locked inside the agent class, unavailable to any synchronous
request path.

**Decision / outcome**:
- Extracted shared helpers into `src/lib/funding/ai.ts`: `aggregateTenantContext()`,
  `formatContextBlock()`, and a new `refineAnswer()`. The batch agent now imports
  these instead of owning private copies — one source of truth for club-context
  aggregation.
- New `POST /api/funding/applications/[id]/responses/[responseId]/refine` refines
  one response in place via the LLM, writing the result back with `source = AI_DRAFT`.
  Gated on `funding_manage` with 404/400/403 handling.
- Inline UI on the application page: each answer gets a refine panel with an optional
  free-text instruction; empty-answer questions get a one-click "Draft with AI"
  (create empty response → refine). Whole-application drafting still uses the agent +
  proposal-inbox flow — the two are complementary, not a replacement.

**Rationale**:
- Per-response refine is a synchronous, low-stakes edit the user explicitly triggers
  and immediately sees — it doesn't need the propose-not-publish inbox ceremony that
  whole-application drafting warrants.
- Sharing `funding/ai.ts` stops the context-aggregation logic drifting between the
  batch and inline paths, which would have produced inconsistent drafts from
  identical club data.

**Notes**: `refine.test.ts` covers the endpoint. Six i18n keys added to `funding.json`
(en + cy) for the refine/draft UI; a pre-existing `application.cancel` gap was
backfilled in the same pass. Ships in the `feat/charity-permissions-20260518162137`
merge alongside the bookings + funding permission-check migration.
