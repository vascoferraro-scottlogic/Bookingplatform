# BookingPlatform — Tooling Review

## Context

BookingPlatform is a multi-tenant booking/club-management SaaS codebase being repurposed as a **QA training exercise** ("Project Phoenix") for a graduate Test Engineer cohort. The plan is:

- **Local** — each of ~20 graduates clones the repo and runs their own copy, so they can edit code and write automation tests against it.
- **Playground** — one shared, low-stakes hosted instance for quick exploration (no local setup required), ≤20 concurrent users, used for roughly a month per cohort then left dormant until the next intake.

This review goes through every tool/service currently implemented in the repo and evaluates whether it earns its keep against those two environments.

**Verdicts:** Keep · Drop · Optional · N/A (doesn't apply to that environment)

---

## 1. Application stack (the thing under test)

These aren't really infra choices to revisit — they *are* the exercise's subject matter. Flagged only for testability implications.

| Tool | Local | Playground | Notes |
|---|---|---|---|
| Next.js 16 (App Router), React 19, TS 6 | Keep | Keep | Core surface graduates are testing. |
| Tailwind CSS v4 | Keep | Keep | No design system underneath it — itself a finding worth graduates noticing. |
| Prisma 7 + `@prisma/adapter-pg` | Keep | Keep | Schema-level issues (string-typed dates, no unique constraints on the booking-slot table) are legitimate bug-hunting material. |
| PostgreSQL | Keep | Keep | Right-sized either way. |
| NextAuth v4 (JWT) + bcryptjs | Keep | Keep | Core content — the deliberately orthogonal role model and admin impersonation carry known planted bugs. Don't touch. |

---

## 2. Feature flags

| Tool | Local | Playground | Rationale |
|---|---|---|---|
| Unleash (self-hosted control plane + its own Postgres DB) | Drop | Drop | Built for live percentage rollout and per-user targeting across an ongoing service. A fixed cohort with flags set once needs none of that — it's a second service + second database for zero benefit here. |
| In-house Postgres-flag fallback (already the pre-cutover default path) | Keep | Keep | Already does the whole job without Unleash running. |

---

## 3. i18n

| Tool | Local | Playground | Rationale |
|---|---|---|---|
| next-intl (en + cy) | Optional | Optional | Harmless to leave, solves a problem an English-speaking internal cohort doesn't have. Not worth ripping out, but genuinely idle for this use case. |

---

## 4. Observability

| Tool | Local | Playground | Rationale |
|---|---|---|---|
| Better Stack logging integration | Drop | Drop | Inert without a token already — but there's no reason to configure it either. Docker/console logs are enough for a one-month lab with a facilitator watching. |
| In-house structured stdout logging | Keep | Keep | Free, already there, sufficient for both. |

---

## 5. External integrations

| Tool | Local | Playground | Rationale |
|---|---|---|---|
| Payments — in-house stub (no real Stripe) | Keep | Keep | Correct choice regardless — a training app should never touch real money. The stub's own bugs are testable content. |
| Outbound email/SMS — in-house stub (writes rows, delivers nothing) | Keep | Keep | Same reasoning; also avoids graduates accidentally spamming real inboxes. |
| Google Gemini (agent framework, AI drafting features) | Keep, watch quota | Keep, watch quota | Real integration. The free tier's request-per-minute limit is fine for one grad locally, but a real ceiling if several playground users hit AI features at once. Budget a paid key for the shared instance if this feature is in scope. |
| Weather integrations (OpenWeatherMap / Open-Meteo) | Keep | Keep | Real, low-stakes, no cost concern at this scale. |

---

## 6. Real-time / streaming

| Tool | Local | Playground | Rationale |
|---|---|---|---|
| In-process SSE registry (messaging) | Keep | Keep, note the ceiling | Fine at ≤20 users on one process; wouldn't survive horizontal scaling, which is irrelevant here. |
| WebRTC signalling endpoint (live streaming) | N/A | N/A | Dead code path — no actual peer-connection/video transport exists on the client, despite the feature being marked "Complete" in the product docs. Worth flagging to graduates as a discovered gap rather than fixing it. |

---

## 7. ML sidecar (Python/FastAPI/scikit-learn)

| Tool | Local | Playground | Rationale |
|---|---|---|---|
| Prediction endpoint (no-show scoring) | Optional | Optional | Keep only if this feature is explicitly in scope for testing. Python isn't required to run the base app either way. |
| Full ModelOps lifecycle (retrain gate, drift detection) | Drop | Drop | Needs sustained usage over weeks to ever produce a signal — a single 4-week cohort will essentially never trigger it. Not worth standing up for either environment. |

---

## 8. Testing & lint tooling

| Tool | Local | Playground | Rationale |
|---|---|---|---|
| Jest + ts-jest (~50 backend test files) | Keep | N/A | Good reference material for how the existing suite is structured — but it's 100% server-side. |
| `jest-html-reporters` | Drop | N/A | Installed as a dependency, never wired into the Jest config. Dead weight. |
| ESLint | Fix or drop | N/A | Installed, a lint script exists, but **no config file exists anywhere in the repo**. Currently non-functional as shipped. |
| Playwright / Cypress / React Testing Library | **Missing — add** | N/A | None exist: no e2e directory, no browser-automation dependency, no component-test setup. If "write automation tests" includes UI-level automation, this is a from-scratch setup for every graduate independently unless scaffolded once centrally before the cohort starts. |

---

## 9. Deployment / infrastructure

| Tool | Local | Playground | Rationale |
|---|---|---|---|
| Docker + multi-stage build | Optional fallback | Keep | For local, native dev-server startup beats a container when the whole point is editing code with hot reload. For the playground, a container is the natural deploy unit. |
| Docker Compose blue/green (dual app instances + swap) | N/A | **Drop** | Solves zero-downtime deploys for continuous production load. A month-long low-stakes playground tolerates a short restart trivially; running two colours doubles resource use for no benefit. Moot locally — one person, one machine. |
| Reverse proxy (Caddy) | N/A | Keep, simplified | Only relevant to the playground's public entrypoint once blue/green is dropped — point it at one app container. Could be skipped entirely if deploying to a PaaS with built-in TLS. |
| In-house cross-platform Compose tooling | Keep, if using Docker locally | Keep (partial) | Well-matched to a Windows-heavy grad cohort *if* they choose the Docker route locally. The blue/green-swap half becomes unnecessary once that's dropped from the playground. |
| Prebuilt multi-arch container images (GHCR) | Optional | Optional, narrower | Valuable for grads who pick Docker locally on mixed laptop architectures. For the playground specifically, multi-arch breadth isn't needed — it deploys to one fixed host/architecture. |
| CI (GitHub Actions) | N/A | Keep | Only builds/publishes images currently, no test/lint gate. Consistent with the training premise ("quality is unknown") — not necessarily a gap to fix by default here. |

---

## 10. Misc dev/ops scripts

| Tool | Local | Playground | Rationale |
|---|---|---|---|
| Environment/config loading (dotenv) | Keep | Keep | Standard, no issue. |
| CLI wrapper scripts (agent runner, billing runner, ML runner) | Keep | Keep | Thin wrappers over HTTP endpoints; fine as-is, no scheduler needed at this scale. |
| Seed script + test-tenant cleanup script | Not needed | **Repurpose — add missing piece** | These are the building blocks for a playground reset job that doesn't currently exist. Twenty people mutating one shared demo tenant over a month will degrade it; nothing resets it. Wire a scheduled truncate-and-reseed using these two scripts as the base. |

---

## Net recommendations

**Drop for the playground:** Unleash (and its DB), the blue/green dual-instance setup, Better Stack.
**Drop everywhere:** the unused HTML test-reporter dependency.
**Fix or remove:** ESLint — currently shipped non-functional (no config file present).
**Add:** a scheduled playground reset job (cheap — reuses existing seed/cleanup scripts); browser-automation test scaffolding (Playwright or equivalent) if UI-level automation is genuinely part of the exercise, so graduates aren't each solving the same setup problem independently.
**Leave idle, don't bother removing:** next-intl, the ML ModelOps lifecycle, the WebRTC signalling stub — none of these cost anything to leave dormant, and the WebRTC gap in particular is better left as something graduates discover than something quietly patched away.
