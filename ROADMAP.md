# Roadmap — BookingPlatform

Where this is headed. Curated deliberately — edit when a real direction shifts,
not on every tactical decision. Newly identified work usually lands in **Later**
first; promotion to **Next** signals it's queued for the upcoming sprint;
**Now** is what's actively in flight (mirrored in `IN_FLIGHT.md`).

`#tags` thread through to `IN_FLIGHT.md`, `DECISIONS.md`,
`parked-plans/<tag>.md`, and `/memories/repo/open-questions.md`.

`VISION.md` is the longer-horizon north star this roadmap serves.

---

## Now

- ~~`#feature-management`~~ (M) — self-hosted Unleash flag control plane shipped
  (Phases 0–4): hybrid Postgres/Unleash routing, 9 platform flags cut over,
  targeting recipes verified, ops runbook. See `IN_FLIGHT.md` /
  `docs/unleash-runbook.md`.
- ~~`#ml-noshow` / `#modelops`~~ — ML no-show prediction + full ModelOps lifecycle shipped. See `IN_FLIGHT.md`.
- `#business-insights` (M) — tenant-facing business analytics dashboard:
  bookings over time, revenue trend, occupancy, cancellation rate, peak
  hours, member activity, task completion. Recharts + server-side
  aggregation. Feature-flag gated (`businessInsights`).
- ~~`#hosting` (local)~~ — zero-cost blue/green **local stack + observability
  SHIPPED** (Docker Compose blue/green behind Caddy :8090, zero-downtime swap,
  public `/api/health`, `migrate deploy` + seed-if-empty, Better Stack seam),
  verified end-to-end. Cloud variant → Later (`#hosting-cloud`). See
  `DECISIONS.md` 2026-06-21.

## Next

- `#modular-services` (M) — multi-vertical, capability-modular platform: `Vertical` enum preset, `bookings` flag, adaptive onboarding wizard, capability-gated nav, Charity Admin plan, branding neutralisation. Unblocks UK CIOs and non-bowling orgs. **Implementing now.** Plan: session notes + `DECISIONS.md` 2026-06-19.
- `#i18n` (L) — `next-intl` integration, tenant-locale-driven translations
  (dashboard + public club pages), Welsh (cy) first. Phase 1 (infra) shipped;
  string extraction (Phase 2–3) + Welsh translations (Phase 4) + public pages
  (Phase 5) + QA (Phase 6) remain. Plan: `parked-plans/i18n.md`.
- `#billing` (L) — platform subscription model (`PlatformPlan`,
  `TenantBillingProfile`, invoice generation) + financial dashboards
  (platform finance, agent costs, tenant billing portal). Stub payment
  engine; recharts for charts. Plan: `parked-plans/billing.md`.
- `#midge-forecast` (S) — UK midge-risk badge on booking weather widget.
  Heuristic from Open-Meteo data. Gated on `Tenant.country ∈ {GB, NI}` +
  `midgeForecast` flag. Plan: `parked-plans/midge-forecast.md`.
- `#multi-slot-booking` (M) — multi-select availability grid, aggregate
  pricing (`slotCount × £10`), atomic conflict reporting. Plan in
  `DECISIONS.md` 2026-05-03.

## Later

- `#hosting-cloud` (M) — deploy the same Compose topology to an Oracle
  Always-Free ARM VM via Coolify (push-to-deploy, auto-TLS); durable Postgres
  off-box on Neon, nightly `pg_dump` → Cloudflare R2, Better Stack uptime +
  heartbeats. Local stack already shipped (`#hosting`); Render+Neon kept as a
  documented zero-management fallback. See `DECISIONS.md` 2026-06-21.
- `#facility-generalisation` (L) — generalise "Green / Rink" domain vocabulary to "Facility / Resource" with a `facilityType` discriminator, enabling golf/cricket real bookings. ~1,100 LoC, ~65% structural. Gated on a vertical actually needing real bookings. See `DECISIONS.md` 2026-06-19.
- `#site-health` (L) — modular Site Advisor + Platform Health agents,
  content onboarding gate, benchmarks utility. (Phase 12.)
- `#settings-lifecycle` (M) — tenant `/dashboard/settings` hub (branding,
  hours, language) + suspension/reactivation UI + member self-service.
  (Phase 4.)
- `#billing-stripe` (L) — real Stripe/GoCardless integration, self-serve
  plan changes, proration, PDF invoices. Depends on `#billing` landing
  first. (Phase 5b.)
- `#notifications` (M) — web push (service worker + VAPID) + email digests +
  per-channel preferences. (Phase 6.)
- `#pwa` (M) — manifest.json + service worker + offline booking-grid
  read-only fallback + touch-first review. (Phase 7.)
- `#reports-exports` (M) — CSV exports (bookings, members, payments, audit) +
  monthly report email. (Phase 8.)
- `#advertising` (L) — two-sided digital hoardings system (direct-sold v1),
  ad-serving substrate, 3 standalone agents + 2 evaluator modules in
  Site/Platform Health. (Phase 13.)
- `#agents-v2` (M) — agent config to platform plane, structured form,
  new agents (scheduler, anomaly, churn-warning), cost capping. (Phase 14.)
- `#booking-fee` (S) — tenant-configurable per-slot fee.
  `TenantConfig.bookingFeePence` + settings UI + correct FEATURES.md.
- `#settings-hub` (M) — broaden `/dashboard/settings` beyond location
  (branding, hours, language entries).
- `#forgot-password` (S) — complete the password-reset loop
  (`PasswordResetToken` table, API route, reset page, PATCH consume).
- `#agent-self-supersede` (S) — on each detector run, supersede own stale
  PENDING proposals whose topic cluster has been refreshed. **Pull in
  before the inbox sees production traffic.** Plan:
  `parked-plans/agent-v2-followups.md`.
- `#triager-proposals` (S) — migrate triager from direct `MaintenanceTask`
  writes to `MAINTENANCE_TASK_ASSIGN` proposal kind + committer. Plan:
  `parked-plans/agent-v2-followups.md`.
- `#tar-doc-uploads` (S) — document upload infrastructure for TAR wizard
  (constitution PDFs, prior CC submissions) + feed into LLM context.
  Parked pending storage backend decision (S3-compat vs GDrive API).

## Deferred

- `#i18n` (L) — `next-intl` integration, tenant-locale-driven translations
  (dashboard + public club pages), Welsh (cy) first. No URL prefix routing —
  locale follows club setting. Phase 1 (infra) shipped; Phases 2–6 remain.
  Promoted from Deferred → Next 2026-05-06.
- `#federations` — shipped as part of `#permission-groups` C4–C6. (2026-05-09)
- `#observability` (M) — error tracking (Sentry), health endpoint,
  rate-limit + agent-cost dashboards. (Phase 11.)

---

## Done (shipped to main)

- `#acquisition-pipeline` — lead capture, `TenantApplication`, platform
  approval queue, provisioning on approve. (2026-05-04)
- `#email-delivery` — stubbed `OutboundMessage` + templates + platform
  inspector. Real provider (Resend) wiring deferred. (2026-05-04)
- `#onboarding-wizard` — 10-chapter guided flow, `OnboardingProgress`,
  go-live transition ONBOARDING→ACTIVE. (2026-05-04)
- `#charity-accounts` — UK/NI charity ledger, R&P + SoAL reports, CSV
  export, year-lock lifecycle. (2026-05-04)
- `#tar-wizard` — TAR wizard with LLM-assisted drafting, unlock cascade,
  readiness warnings. All three regulators. (2026-05-05)
- `#permission-groups` — permission groups (C1–C3) + federation v1 (C4–C6):
  dual gate, groups CRUD UI, federation lifecycle API, cross-club booking
  with clash detection, federation UI. 476 tests. (2026-05-09)

---

## Sequencing summary

```
[SHIPPED] #acquisition-pipeline → #email-delivery → #onboarding-wizard
                                                          │
                                    ┌─────────────────────┘
                                    ↓
                          #settings-lifecycle
                                    │
                                    ├─→ #site-health ─→ #advertising ─→ #agents-v2
                                    ↓
                               #billing
                                    │
                                    ↓
                               #notifications ─→ #pwa
                                    │
                                    ↓
                               #reports-exports ─→ #i18n ─→ #federations

#observability — runs alongside, not blocking
#permission-groups — independent track (no pipeline dependency)
#midge-forecast — independent (Tenant.country already landed)
```

**Critical path to "real club can self-serve onboard end-to-end"**:
`#acquisition-pipeline` → `#email-delivery` → `#onboarding-wizard`.
Everything else is value-add.

---

**Sizing key**: S = a session, M = a few sessions, L = a focused sprint.
