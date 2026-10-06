# In flight — BookingPlatform

What's open right now, across chat sessions. Read this at the start of any
non-trivial task — if a topic already has an active or parked thread, resume
the existing session (or branch off deliberately) rather than starting from
scratch.

**Conventions**:
- One `#tag` per topic. Tags thread through `ROADMAP.md`, `DECISIONS.md`,
  `parked-plans/<tag>.md`, and `/memories/repo/open-questions.md`. Grep one
  tag to see its full lifecycle.
- "Recently landed" caps at the last ~5 entries; older shipped work lives
  in `DECISIONS.md`.
- "Just parked" is a one-line pointer; the *why* lives in
  `/memories/repo/open-questions.md`, the *how* (refined plan) lives in
  `parked-plans/<tag>.md` if one exists.
- When ye start a new chat session for a topic, rename the session to
  `bp: #<tag>` so it lines up with this ledger.

---

## Active threads

- `#billing` — platform subscription model + financial dashboards. Phase A (schema) done; Phase B (API) next. Session: `bp: #billing`.

<!-- Format:
- `#<tag>` — one-sentence intent. Session: `bp: #<tag>`. Branch: `<name>` (optional).

- `#billing` — platform subscription model + financial dashboards. Phase A (schema) done; Phase B (API) next. Session: `bp: #billing`.



- `#agent-self-supersede` — Step 3c-iv of agent-v2 plan: detector should mark its own stale PENDING proposals as SUPERSEDED on subsequent runs. Plan: `parked-plans/agent-v2-followups.md`. **Pull in before inbox sees production traffic.**
- `#midge-forecast` — implementation plan complete, blocked on nothing. Plan: `parked-plans/midge-forecast.md`.
- `#multi-slot-booking` — design decided, plan in `DECISIONS.md` 2026-05-03. No parked-plan file.

---

## Recently landed

- 2026-06-21 — `#hosting` LOCAL stack landed (Phases 0/1/4): Dockerised blue/green (app-blue/green) + Postgres + Unleash + ML sidecar behind Caddy; zero-downtime colour swap; public `/api/health` with `color`+`release`; `migrate deploy` + seed-if-empty init; Better Stack observability seam (`@logtail/next`, inert without token) emitting structured JSON to stdout. Verified end-to-end incl. http login on :8090. Cloud (Oracle ARM + Coolify) deferred. **2026-06-26 follow-up: tooling made cross-platform (`bin/stack.mjs`/`bin/swap.mjs`, engine-overridable via `COMPOSE_CMD`), tester "Blue/Green Infra Lab" added to `docs/WORKSHOP-SETUP.md`, Rancher Desktop (moby) recommended as the free Docker Desktop replacement. GHCR pull path added (multi-arch amd64+arm64 images via `.github/workflows/build-images.yml`, `docker-compose.ghcr.yml` overlay, `npm run stack:pull`/`stack:up:ghcr`) so testers download prebuilt images instead of building.** See `DECISIONS.md`.
- 2026-06-20 — `#feature-management` FULLY SHIPPED (Phases 0–4): self-hosted Unleash control plane behind the `isFeatureEnabled` seam; 9 platform flags migrated + cut over (`tenantId IN […]`), parity 18/18; nav + homepage router-aware; targeting recipes verified (incl. `grp:<cuid>` STR_CONTAINS spike 7/7, collision-safe on fixed-length cuids); ops runbook `docs/unleash-runbook.md`. Reversible by unsetting the env. See `DECISIONS.md` (4 entries).
- 2026-06-19 — `#modular-services` shipped: Vertical enum + bookings flag, adaptive wizard (ch5 skippable), cap-gated nav, Charity Admin plan, branding neutralised. See `DECISIONS.md`.
- 2026-06-18 — `#modelops` fully shipped (extends `#ml-noshow`): prediction persistence root fix, MlModelVersion/MlFeatureDefinition/MlDriftCheck schema, champion/challenger retrain gate, drift check, feature registry (enroll/retire), model-health dashboard, operator runbook. Bug #15 resolved. See `DECISIONS.md`.
- 2026-06-17 — `#ml-noshow` Phases 0–4 shipped: Python sidecar, NoShowRiskAgent, eval script, 26 pytest + 8 jest. See `DECISIONS.md`.

_(Older shipped threads — `#business-insights`, `#charity-permissions`, `#funding-applications`, `#permission-groups`, `#i18n`, … — live in `DECISIONS.md`.)_
