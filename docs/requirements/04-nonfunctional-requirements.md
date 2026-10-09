# 04 — Non-Functional Requirements (NFR)

*Tier: Quality attributes · Traces up to: multiple HLBRs*

Non-functional requirements describe *how well* the system must behave, not
*what* it does. They are often where the most damaging defects hide because they
are rarely exercised by happy-path functional tests. Each NFR below is written to
be as measurable as the current design allows; where a target is unstated in the
source material it is marked *(target TBD)* — **an unquantified NFR is itself a
finding**, and part of the exercise is to notice them.

---

### NFR-01 — Tenant isolation (security)
*Traces to:* BR-01 · *Priority:* Must
Under no role, flag state, or impersonation session shall a caller read or write
data belonging to a tenant other than its resolved/impersonated tenant.

### NFR-02 — Authorisation correctness (security)
*Traces to:* BR-06 · *Priority:* Must
Every protected action shall deny callers who lack the sufficient role *or*
permission, and the platform plane shall never satisfy a tenant gate implicitly.

### NFR-03 — Payment integrity (security / correctness)
*Traces to:* BR-09 · *Priority:* Must
Payment webhooks shall be signature-verified and idempotent such that no
replayed, reordered or duplicated callback causes a double-charge, double-refund,
or lost state transition.

### NFR-04 — Auditability (accountability)
*Traces to:* BR-07 · *Priority:* Must
Significant actions shall be attributable to a real actor (and acting-as role
when impersonating) with PII access flagged.
*Note:* audit writes are **fire-and-forget (asynchronous)** — an audit row may
not exist the instant the action's response returns. This timing behaviour is an
implicit part of the requirement, not an accident.

### NFR-05 — Data protection (privacy)
*Traces to:* BR-07 · *Priority:* Must
Access to personal data shall be minimised to the role's need and flagged when
surfaced; exports containing PII shall be access-controlled.
*(Retention/erasure targets: TBD.)*

### NFR-06 — Real-time delivery latency (performance)
*Traces to:* BR-12 · *Priority:* Should
Messaging, notifications and stream go-live events shall be delivered to
connected clients in near real time. *(Latency budget: TBD.)*

### NFR-07 — Availability & zero-downtime deploy (reliability)
*Traces to:* BR-01, BR-20 · *Priority:* Should
The platform shall support zero-downtime releases (local blue/green Compose swap
today) and expose a health endpoint for monitoring.
*(Uptime SLO: TBD; public-cloud deployment is Planned — `#hosting-cloud`.)*

### NFR-08 — Concurrency safety (correctness)
*Traces to:* BR-08, BR-09 · *Priority:* Must
Concurrent booking attempts on the same slot shall not both succeed; concurrent
cancellations and waiting-list promotions shall not corrupt state.

### NFR-09 — Feature-flag reachability (configurability)
*Traces to:* BR-02 · *Priority:* Must
A capability shall be fully reachable when its flag is on and fully unreachable
(UI and API) when off, with no partial/broken intermediate state.

### NFR-10 — Localisation integrity (usability / i18n)
*Traces to:* BR-17 · *Priority:* Should
User-visible strings shall be externalised and resolve in the selected locale or
fall back cleanly; no raw keys or missing-string placeholders shall reach the
user. *(Coverage gate: `npm run check:i18n`.)*

### NFR-11 — Accessibility (usability)
*Traces to:* BR-11, BR-18 · *Priority:* Should
Public and member-facing pages shall meet a recognised accessibility baseline
(e.g. WCAG 2.1 AA). *(Formal conformance target: TBD.)*

### NFR-12 — Browser / device reach (compatibility)
*Traces to:* BR-12 · *Priority:* Could
Core journeys (browse, book, pay, watch) shall work on current evergreen desktop
and mobile browsers; the product shall be installable as a PWA.

### NFR-13 — Maintainability & module boundaries (internal quality)
*Traces to:* BR-02, BR-20 · *Priority:* Could
Modules shall remain independently usable and extraction-ready, with lint-
enforced seams. *(Target state; `#module-boundaries` is Planned.)*

### NFR-14 — AI cost & safety (operational)
*Traces to:* BR-13 · *Priority:* Should
Agent actions that incur LLM cost shall be bounded (per-tenant budget), and
high-impact agent outputs (reminders, drafts) shall be proposed for human
approval rather than auto-executed.

### NFR-15 — Observability (operational)
*Traces to:* BR-20 · *Priority:* Should
The platform shall expose production error tracking, health checks, and
rate-limit and agent-cost visibility, so a small team can detect and diagnose
issues. *(Mostly Planned — `#observability`.)*

### NFR-16 — Automated quality & security gates (operational)
*Traces to:* BR-20 · *Priority:* Should
Changes to the platform shall pass automated gates before release: a blocking
static + test gate on every change, and scheduled security scanning (DAST) and
image scanning. *(Partly landed — CI increment 1; `#ci-pipeline`, `#zap-pipeline`
Planned.)*

---

## Turning quality wishes into requirements

Several NFRs above deliberately carry a *(TBD)* target (e.g. latency budget,
uptime SLO, accessibility conformance level, retention period). **An
unquantified NFR is itself a finding.** Part of analysing this pack is to list
those gaps and propose a *measurable* acceptance criterion you would negotiate
with the product owner for each — turning a vague quality wish ("fast",
"reliable", "accessible") into a number the team can agree on and later verify.
