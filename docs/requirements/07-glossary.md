# 07 — Glossary

Domain and platform vocabulary used across the pack. Knowing the nouns is half of
reading the requirements correctly — several ambiguities in the pack come from
terms that look familiar but mean something specific here.

| Term | Meaning in this product |
|------|-------------------------|
| **Tenant** | One member organisation (a club or charity) on the platform. The unit of data isolation, branding and configuration. |
| **Tenant context** | The single tenant an incoming request has been resolved to; all tenant-scoped data access is confined to it. |
| **Vertical** | The kind of organisation a tenant is (BOWLS, GOLF, CRICKET, MULTI_SPORT, CHARITY_ADMIN, OTHER). Drives the default feature-flag preset. |
| **Capability bundle** | The set of modules a tenant has switched on — its tailored slice of the platform. |
| **Feature flag** | A per-tenant runtime switch that enables/disables a module without a deployment. |
| **Green** | A bowls playing surface. A tenant can have several. (To be generalised to *Facility*.) |
| **Rink** | A bookable lane on a green. (To be generalised to *Resource*.) |
| **Facility / Resource** | The planned generalised vocabulary (FR-BOOK-020/021) so golf holes and cricket pitches share the booking engine. |
| **Facility type** | Planned discriminator (`facilityType`) distinguishing bowls green / golf hole / cricket pitch. |
| **Slot** | A specific rink at a specific time on a specific date — the atomic bookable unit. |
| **Season window** | The date range a green is open for bookings; can be always-open, per-year, or a recurring month-day pair (which may wrap across the year boundary). |
| **Booking lifecycle** | `requested → approved → reserved → confirmed → cancelled/refunded`. |
| **Waiting list** | Members queued for a slot; the first waiter is auto-assigned when a confirmed booking is cancelled. |
| **Admin override** | A tenant admin forcing a booking over a conflict, with a mandatory reason and notification to affected parties. |
| **No-show** | A past confirmed booking the admin marks as not honoured; ground truth for the no-show ML model. |
| **No-show prediction** | ML sidecar score of a future booking's no-show risk; bookings ≥40% are flagged for a reminder proposal. |
| **Federation** | A flat peer agreement between clubs allowing cross-club membership and booking. No hierarchy, no governing body. |
| **Cross-club booking** | A member booking at a partner club via a federation, subject to flag, permission and common-federation checks. |
| **Billing mode (federation)** | How a partner-club booking is charged: `FREE_ACCESS`, `REDUCED_RATE`, or `HOST_CLUB_RATE`. |
| **Clash warning** | A soft, confirm-to-proceed alert for a cross-club booking that overlaps (`CROSS_CLUB_CLASH`) or abuts (`CROSS_CLUB_CONSECUTIVE`) another; never a hard block. |
| **Role** | One of `GUEST`, `USER`, `MAINTENANCE`, `TENANT_ADMIN`, `PLATFORM_ADMIN`. |
| **Tenant plane / ladder** | The ordered tenant roles `GUEST < USER < MAINTENANCE < TENANT_ADMIN`. |
| **Platform plane** | `PLATFORM_ADMIN`, a *separate* plane with no implicit tenant powers. |
| **Impersonation (acting-as)** | A platform admin assuming a tenant role scoped to one tenant to provide support; the real identity is retained for audit. |
| **Effective role** | The role used for permission checks right now (the assumed role while impersonating; otherwise the real role). |
| **Real role / real actor** | The underlying identity (always `PLATFORM_ADMIN` when impersonating) recorded for attribution. |
| **Permission group** | A tenant-defined named bundle of platform-defined permissions assignable to members (finer than roles). |
| **Dual gate** | Authorising a caller who holds either the sufficient role *or* the granting permission. |
| **Platform admin** | The operator persona who onboards, bills and configures tenants. |
| **Acquisition pipeline** | Lead → application → platform approval → automated provisioning. |
| **Onboarding wizard** | The ten-chapter guided setup a new tenant completes before go-live. |
| **Go-live** | The transition `ONBOARDING → ACTIVE` after which a tenant's capabilities are live. |
| **KYC chapter** | The onboarding step capturing country, legal form and financial year-end; auto-enables the charity module when eligible. |
| **CMS section** | A landing-page content block (hero, about, photo, map, contact) with a `draft → review → published → archived` lifecycle. |
| **Content go-live gate** | Planned rule requiring ≥1 hero + ≥1 other published section before a tenant can go live. |
| **Stream lifecycle** | `IDLE → LIVE → ENDED → ARCHIVED` for a live broadcast. |
| **Streaming tier** | Bronze / Silver / Gold plan setting concurrent-stream limits and archive retention. |
| **Channel** | A messaging space: public, private, group, or direct-message. |
| **Agent** | A non-interactive automated actor (triage, task automation, no-show, funding, and planned site/health/advertising agents). |
| **Propose-not-publish** | The agent discipline of emitting a proposal for human approval rather than acting automatically. |
| **Proposal / admin inbox** | The queue where agent proposals await admin approval. |
| **Site Advisor** | Planned tenant-facing agent scoring a club's site and emitting guidance, benchmarked against regional medians. |
| **Platform Health** | Planned platform-facing agent surfacing struggling-club / churn / onboarding-stall signals to the operator. |
| **Charity module** | Accounting + statutory reporting features gated to UK/NI tenants with a charity-eligible legal form. |
| **R&P (Receipts & Payments)** | A cash-basis charity account; the primary statutory output for smaller charities. |
| **SoAL** | Statement of Assets & Liabilities accompanying the R&P account. |
| **TAR** | Trustees' Annual Report; a narrative statutory report drafted with AI assistance. |
| **Regulator** | The charity regulator a tenant reports to: CC E&W (England & Wales), OSCR (Scotland), CCNI (Northern Ireland). |
| **Fund type** | Charity fund classification: unrestricted, restricted, or designated. |
| **Financial-year lock** | Freezing a year's ledger entries; unlocking cascades to invalidate dependent outputs. |
| **Audit event** | A recorded significant action (actor, role, tenant, entity, timestamp), optionally flagged as PII access. |
| **PII access flag** | A marker on an audit event indicating personal data was surfaced. |
| **Fire-and-forget** | The asynchronous way audit writes happen — the row may land shortly *after* the action's response returns. |
| **Business insights** | Tenant-facing analytics on transactional data (bookings, revenue, members, operations), distinct from product-usage analytics. |
| **Advertising marketplace** | Planned two-sided "hoardings" system: club-direct sales plus platform-brokered campaigns, direct-sold only. |
| **MoSCoW** | Prioritisation scheme: Must / Should / Could / Won't (this release). |
| **HLBR** | High-Level Business Requirement — an outcome-level business statement (`BR-nn`). |
| **FR / NFR** | Functional Requirement (`FR-AREA-nnn`) / Non-Functional Requirement (`NFR-nn`). |
| **Orphan** | A requirement that cannot be traced to a parent (FR with no HLBR, HLBR with no vision theme). |
| **Gap** | A business need with no, or only Planned, functional coverage below it. |
