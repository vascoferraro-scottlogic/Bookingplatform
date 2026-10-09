# 01 — Vision & Scope

*Tier: Vision · Traces down to: all HLBRs in [02-business-requirements-HLBR.md](02-business-requirements-HLBR.md)*

---

## 1. Vision statement

> **BookingPlatform is a modular, multi-tenant SaaS platform for member
> organisations** — bowls, golf and cricket clubs, registered charities, CIOs,
> CASCs, and other community organisations. Organisations pay the platform for
> hosting; in return they receive a **capability bundle tailored to what they
> actually need**, delivered as a white-labelled product they can run
> themselves.

The north star: *any member organisation anywhere can sign up, self-onboard
through a guided wizard tailored to its vertical, and be running its relevant
capability bundle within a single session — with ongoing AI-powered guidance
keeping the platform healthy and admin load low.*

### Vision themes (VIS-n)

These themes are the handles the HLBRs trace up to.

| ID | Theme | What it means |
|----|-------|---------------|
| **VIS-1** | Multi-tenant white-label SaaS | Many isolated organisations on one platform, each branded and configured independently. |
| **VIS-2** | Tailored capability bundles | Each tenant gets only the modules its vertical needs, gated by feature flags. |
| **VIS-3** | Self-serve onboarding | A new organisation can go from lead to live within one session via a guided wizard. |
| **VIS-4** | Platform-admin-runs-the-shop | A small platform team onboards, bills, and configures; tenants self-manage inside their flag boundaries. |
| **VIS-5** | Facility operations | Bookings, maintenance, and payments for organisations that manage physical facilities. |
| **VIS-6** | Charity & funding | Ledger, statutory reports, and AI-assisted grant/annual-report drafting for UK/NI charities. |
| **VIS-7** | Member engagement | Events, messaging, live streaming, notifications, a public website. |
| **VIS-8** | AI-powered guidance | Agents triage, automate, predict no-shows, and draft documents to lower admin load. |
| **VIS-9** | Trust & accountability | Audit trail, PII-access tracking, and role/permission-scoped visibility. |
| **VIS-10** | Reach & inclusivity | Internationalisation and globally-distributed organisations with local config. |

---

## 2. Business context

- **Revenue model.** The platform earns a **subscription/platform fee** from
  each organisation, selected as a *plan* at onboarding. Tenants additionally
  take their own money from members (e.g. per-slot booking fees) — the platform
  does not take a cut of tenant income in the current design.
- **Operating model.** *Platform-admin-runs-the-shop*: a small platform team
  performs onboarding, billing and configuration; each organisation
  self-manages within the boundaries set by its feature flags and subscription.
- **Verticals today.** Bowls clubs are the reference vertical (hence the
  "green / rink" vocabulary). Golf and cricket are supported structurally but
  await a facility-vocabulary generalisation before they get *real* bookings.
  Registered charities with no facilities are a first-class, facility-free
  vertical.

---

## 3. Primary stakeholders & actors

| Actor | Plane | Description |
|-------|-------|-------------|
| **Guest / anonymous visitor** | Tenant (unauthenticated) | Sees neutral platform content, or a club's public pages (public events, public streams). |
| **User (member)** | Tenant | A registered member of one club: books slots, joins channels, watches streams, views events. |
| **Maintenance staff** | Tenant | Member with maintenance powers: manages tasks, may broadcast streams. |
| **Tenant admin** | Tenant | Runs one club: config, branding, events, bookings oversight, channels, help overrides, charity accounts. |
| **Platform admin** | **Platform (separate plane)** | Runs the shop: onboards tenants, toggles feature flags, oversees platform billing, and **impersonates** a tenant to provide support. Has **no implicit tenant powers**. |
| **AI agents** | System | Non-interactive automated actors: chat triage, task automation, no-show prediction, funding drafting. |
| **Payment provider** | External | Processes checkout and emits webhooks (signature-verified, idempotent). |

> **Analysis note.** The platform-admin / tenant boundary is *orthogonal*, not a
> ladder: a platform admin is not "a super tenant admin". To act on tenant data
> they must explicitly impersonate. This single design decision is the richest
> source of edge cases in the whole product — keep it front of mind when reading
> any access-control requirement.

---

## 4. Scope

### 4.1 In scope (reverse-engineered as built or designed)

- Multi-tenant hosting, tenant resolution, per-tenant branding/config.
- Role-based access control, permission groups, impersonation.
- Feature-flag-gated capability modules per tenant.
- Acquisition pipeline, onboarding wizard, go-live lifecycle.
- Bookings: availability grid, lifecycle, season/opening-hours enforcement,
  waiting list, cancellation policy, admin override, no-show handling and
  ML-based no-show prediction, cross-club (federation) booking.
- Payments: booking checkout, refunds, webhook receiver, tenant pricing.
- Content management (headless CMS), events, cross-club event sharing, weather.
- Live streaming (tiered plans), messaging, notifications.
- Maintenance task management.
- AI agents & automation.
- Charity accounts and statutory reporting (R&P, SoAL, TAR) for UK/NI.
- Analytics and business insights.
- Audit trail with PII-access tracking.
- Authentication (login/registration; password reset partial).
- Internationalisation (four locales; in progress).
- Help centre.
- Progressive Web App packaging.

### 4.2 Planned & designed (covered in this pack as *Planned* requirements)

These are on the roadmap or captured in `parked-plans/` design files. They are
**in scope for analysis** — each appears as a *Planned* (or *WIP*) requirement:

- **Platform billing** — subscription plans, billing profiles, invoice line
  items, proration, PDF invoices, operator/tenant financial dashboards.
- **Business insights** — tenant-facing bookings/revenue/occupancy/members/
  operations analytics; platform-level benchmarks.
- **Site health & guidance** — content onboarding gate, Site Advisor agent
  (per-club guidance + regional benchmarks) and Platform Health agent
  (estate-wide intervention signals).
- **Advertising marketplace** — two-sided digital "hoardings" (club-direct +
  platform-brokered), direct-sold v1, with prospector/creative/pricing agents.
- **Agents v2** — agent config on the platform plane; new scheduler, anomaly and
  churn-warning agents; per-tenant agent cost capping.
- **Facility generalisation** — generalise "Green / Rink" to "Facility /
  Resource" with a `facilityType` discriminator, enabling real golf/cricket
  bookings on the same engine.
- **Federation enhancements** — configurable cross-club billing modes, platform
  guardrails, soft clash warnings.
- **Notifications** — web push + email digests + per-channel preferences.
- **Reports & exports** — CSV exports (bookings, members, payments, audit) +
  monthly report email.
- **Settings lifecycle** — tenant settings hub (branding, hours, language),
  suspension/reactivation, member self-service.
- **Internationalisation** — full translations and localised public pages
  (Welsh first).
- **Password reset**, **TAR document uploads**, **midge forecast** — small
  completions of partially-built flows.
- **Real integrations** — live payment provider (Stripe/GoCardless), real
  email/SMS delivery, public-cloud deployment.

### 4.3 Explicitly out of scope (not planned)

- Real-time bidding / third-party ad tags (advertising is direct-sold only).
- Hierarchical federations with a governing body (federations are flat peer
  agreements by design).
- Taking a platform commission on tenant booking income (the platform charges a
  subscription fee, not a cut of club takings).

---

## 5. Assumptions & constraints

| # | Assumption / constraint | Why it matters for analysis |
|---|-------------------------|-----------------------------|
| C1 | One organisation = one tenant; data is isolated per tenant. | Isolation is implied by almost every requirement even when unstated. |
| C2 | Modules are toggled by per-tenant feature flags at runtime, without deployment. | A requirement can be *correct* yet *unreachable* because a flag is off — flag state is an implicit precondition. |
| C3 | The "green / rink" vocabulary is bowls-specific; golf/cricket reuse the same engine. | Vocabulary ≠ capability; a golf club cannot take real bookings until facility generalisation lands. |
| C4 | Charity features are gated to UK/NI tenants with a charity-eligible legal form. | Eligibility is a boundary condition baked into the requirement. |
| C5 | Payments and email are stubbed. | "Payment succeeded" currently means the stub + webhook completed, not that money moved. |
| C6 | Audit writes are *fire-and-forget* (asynchronous). | An audit row may not exist the instant an action returns — a timing assumption hidden in FR-AUD. |
| C7 | Platform admins have no implicit tenant powers; support is via impersonation. | Attribution must record the *real* actor plus the *acting-as* role. |

---

## 6. Success criteria (vision-level)

- A real club can self-serve onboard end-to-end (lead → application → approval →
  provisioned tenant → wizard → go-live) within a single session.
- A tenant sees only the modules its vertical needs, and cannot reach modules
  whose flags are off.
- No tenant can read or write another tenant's data under any role, including an
  impersonating platform admin acting outside the impersonated tenant.
- Every significant action is attributable to a real actor, with PII access
  explicitly flagged.
