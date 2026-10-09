# 02 — High-Level Business Requirements (HLBR)

*Tier: Business · Traces up to: [Vision themes](01-vision-and-scope.md#vision-themes-vis-n) · Traces down to: [Functional Requirements](03-functional-requirements.md)*

Each HLBR is an **outcome the business must achieve**, deliberately
technology-neutral. The detailed *how* lives in the functional requirements that
decompose it. Read the **rationale** to understand *why* the requirement exists —
that is where the risk lives.

**Priority** = MoSCoW. **Decomposes into** lists the functional-requirement areas
that implement the HLBR.

---

### BR-01 — Isolated multi-tenant hosting
*Traces to:* VIS-1 · *Priority:* Must · *Decomposes into:* FR-SEC, FR-TEN

The platform **must** host many member organisations on shared infrastructure
while keeping each organisation's data, branding and configuration fully
isolated, so that no organisation can see or affect another.

*Rationale:* The commercial model is one platform serving many clubs; a single
cross-tenant data leak would be catastrophic to trust and likely unlawful under
data-protection law. Isolation is the load-bearing requirement for the whole
business.

---

### BR-02 — Tailored capability bundles per tenant
*Traces to:* VIS-2 · *Priority:* Must · *Decomposes into:* FR-TEN, FR-FLAG

The platform **must** let each tenant run only the capability modules its
vertical needs, with modules switchable per tenant at runtime without a
deployment.

*Rationale:* A facility-free charity should not see greens and rinks; a bowls
club should not see a chart of accounts unless it is also a charity. Bundling by
flag is how one codebase serves many verticals.

---

### BR-03 — Platform-operated, tenant-self-managed
*Traces to:* VIS-4 · *Priority:* Must · *Decomposes into:* FR-SEC, FR-FLAG, FR-ADM

A small platform team **must** be able to onboard, configure and bill tenants,
while each tenant self-manages its own content, members and settings strictly
within the boundaries set by its feature flags and subscription.

*Rationale:* The operating model keeps platform overhead low (few staff, many
clubs) while giving clubs autonomy. The boundary between "platform can" and
"tenant can" is the core authorisation surface.

---

### BR-04 — Self-serve acquisition and onboarding
*Traces to:* VIS-3 · *Priority:* Must · *Decomposes into:* FR-ONB

A prospective organisation **must** be able to progress from initial enquiry to
a live, usable tenant through a guided, resumable flow: lead capture →
application → platform approval → automated provisioning → setup wizard →
go-live.

*Rationale:* The north star is "running within a single session". Manual
onboarding does not scale with a small platform team; the pipeline is how growth
stays cheap.

---

### BR-05 — Subscription revenue for the platform
*Traces to:* VIS-1, VIS-4 · *Priority:* Should · *Decomposes into:* FR-BIL

The platform **must** be able to charge each tenant a recurring platform fee
based on a plan the tenant selects, and give the platform operator visibility of
billing and plan status.

*Rationale:* This is how the platform funds itself. (Currently **WIP**:
schema + API in progress; real provider integration is a later phase.)

---

### BR-06 — Role- and permission-based access control
*Traces to:* VIS-4, VIS-9 · *Priority:* Must · *Decomposes into:* FR-SEC

The platform **must** enforce access control through a small set of roles
(guest, user, maintenance, tenant admin, platform admin), augmented by assignable
permission groups for finer control, and **must** support a platform admin
safely acting on a tenant's behalf (impersonation) without gaining implicit
tenant powers.

*Rationale:* Different members need different powers; platform support needs to
"stand in a club's shoes" without becoming a backdoor. The orthogonal
platform/tenant model exists precisely to prevent privilege leakage.

---

### BR-07 — Accountability and data-protection by design
*Traces to:* VIS-9 · *Priority:* Must · *Decomposes into:* FR-AUD

Every significant action **must** be recorded with its actor, role, tenant,
affected entity and timestamp, and any action that surfaces personal data
**must** be explicitly flagged, with visibility of the record scoped to the
viewer's role.

*Rationale:* Trust, dispute resolution, and data-protection compliance all
depend on an attributable, queryable history — especially for impersonated
actions and PII access.

---

### BR-08 — Facility bookings
*Traces to:* VIS-5 · *Priority:* Must · *Decomposes into:* FR-BOOK

Facility-based organisations **must** be able to let members find and book
bookable slots on their facilities, with the organisation's rules (season
windows, opening hours, cancellation policy, capacity) enforced automatically.

*Rationale:* Bookings are the primary value for the reference vertical; the rules
are what make the booking *correct* rather than just *stored*.

---

### BR-09 — Taking payment for bookings
*Traces to:* VIS-5 · *Priority:* Must · *Decomposes into:* FR-PAY

Where an organisation charges for bookings, the platform **must** collect payment
at confirmation, refund automatically on qualifying cancellation, and process
provider callbacks safely (verified and idempotent), with each organisation
setting its own fees.

*Rationale:* Money movement is high-risk: double-charges, missed refunds, or
replayed webhooks erode trust fast. Idempotency and verification are
non-negotiable.

---

### BR-10 — Facility maintenance management
*Traces to:* VIS-5, VIS-8 · *Priority:* Should · *Decomposes into:* FR-MNT, FR-AGT

Organisations with managed facilities **must** be able to raise, triage, assign,
progress and close maintenance tasks, with categories and priorities, and with
automation assisting triage and routing.

*Rationale:* Facilities degrade; a structured, auditable maintenance loop keeps
them safe and playable and feeds the AI-guidance ambition.

---

### BR-11 — Public presence, events and content
*Traces to:* VIS-7 · *Priority:* Should · *Decomposes into:* FR-CMS, FR-EVT

Each organisation **must** be able to present a white-labelled public website
(managed content sections) and publish events that are either members-only or
public, optionally shared with federated clubs.

*Rationale:* A club's public face drives member acquisition and engagement;
content and events are how non-members first meet the club.

---

### BR-12 — Member engagement channels
*Traces to:* VIS-7 · *Priority:* Should · *Decomposes into:* FR-MSG, FR-STR, FR-NTF

Members **must** be able to communicate (channels/messaging), watch live
broadcasts of play (tiered streaming), and receive timely in-app notifications
about things that concern them.

*Rationale:* Engagement retains members and differentiates the platform; real-
time delivery is the expectation bar.

---

### BR-13 — AI-assisted operations
*Traces to:* VIS-8 · *Priority:* Should · *Decomposes into:* FR-AGT

The platform **must** reduce admin load with automated agents that triage member
messages into tasks, apply rules to tasks, predict booking no-shows and prompt
proactive reminders, and draft funding applications and statutory reports.

*Rationale:* "Ongoing AI-powered guidance keeping admin load low" is a stated
north-star pillar; agents are how a tiny club committee runs a professional
operation.

---

### BR-14 — Charity accounting and statutory reporting
*Traces to:* VIS-6 · *Priority:* Must *(for charity vertical)* · *Decomposes into:* FR-CHA

UK/NI charitable organisations **must** be able to keep a receipts-and-payments
ledger with funds and lockable financial years, and produce the statutory
outputs their regulator requires (Receipts & Payments account, Statement of
Assets & Liabilities, Trustees' Annual Report), with AI assistance for drafting.

*Rationale:* Charities are legally obliged to report; doing it correctly for the
right regulator (CC E&W / OSCR / CCNI) is the entire value of the charity
vertical.

---

### BR-15 — Analytics and business insight
*Traces to:* VIS-8, VIS-4 · *Priority:* Could · *Decomposes into:* FR-ANL

The platform **must** capture usage data for all visitors and present it as
actionable analytics for tenant admins (traffic, bookings, revenue, occupancy,
cancellations, peak hours, member activity) and platform-level insight for the
operator.

*Rationale:* Clubs and the platform both need evidence to make decisions;
insight closes the loop on the AI-guidance ambition. (Business insights **WIP**.)

---

### BR-16 — Cross-club federation
*Traces to:* VIS-1 (future ambitions) · *Priority:* Could · *Decomposes into:* FR-FED, FR-BOOK, FR-EVT

Clubs **must** be able to form federations so that a member of one club can act
as a member of another — notably booking at a partner club — with clash warnings
and permission gating.

*Rationale:* Federations extend the network effect and member value across club
boundaries while keeping each club's rules intact.

---

### BR-17 — Internationalisation
*Traces to:* VIS-10 · *Priority:* Could · *Decomposes into:* FR-I18N

The platform **must** be able to present its interface in multiple locales with
sensible fallback, driven by tenant/user locale.

*Rationale:* Reach beyond English-first markets (Welsh first) supports the
"any organisation anywhere" ambition. (Currently **WIP**: infrastructure
shipped; translations and public pages in progress.)

---

### BR-18 — In-product help and guidance
*Traces to:* VIS-8 · *Priority:* Could · *Decomposes into:* FR-HLP

Users **must** be able to find contextual help (searchable articles, audience-
filtered, locale-aware), and tenant admins **must** be able to customise or hide
help for their members.

*Rationale:* Self-service help lowers support load, reinforcing the small-team
operating model.

---

### BR-19 — Club advertising revenue
*Traces to:* VIS-7, VIS-1 · *Priority:* Could · *Status: Planned* · *Decomposes into:* FR-ADV

The platform **should** let clubs earn advertising revenue on their sites via a
two-sided marketplace (club-direct sales plus platform-brokered multi-club
campaigns) on a single ad-serving substrate, direct-sold only in the first
version.

*Rationale:* The "hoardings on the green" model gives clubs a familiar new income
stream and the platform a brokerage opportunity, without the heavy consent/cookie
surface of programmatic advertising. (Designed; depends on site-health landing
first.)

---

### BR-20 — Operable, observable, continuously-delivered platform
*Traces to:* VIS-4 · *Priority:* Should · *Decomposes into:* NFR-07, NFR-13, NFR-15, NFR-16

The platform **must** be operable by a small team: releasable at will with
minimal downtime, observable in production (errors, health, agent cost), and
protected by automated quality and security gates.

*Rationale:* "Platform-runs-the-shop" only works if running the shop is cheap and
safe. Delivery pipeline, observability, module boundaries and security scanning
are the operational spine behind the product. (Mostly **Planned**; see the NFRs.)

---

| Priority | HLBRs |
|----------|-------|
| **Must** | BR-01, BR-02, BR-03, BR-04, BR-06, BR-07, BR-08, BR-09, BR-14 |
| **Should** | BR-05, BR-10, BR-11, BR-12, BR-13, BR-20 |
| **Could** | BR-15, BR-16, BR-17, BR-18, BR-19 |

> **Analysis exercise.** Some HLBRs here are marked *Must* but are served partly
> or wholly by functional areas that are only *WIP* / *Planned* (see the status
> tags in [03-functional-requirements.md](03-functional-requirements.md) and the
> gap read-out in [05-traceability-matrix.md](05-traceability-matrix.md)). Find
> them. A high-priority business requirement with no shipped functional coverage
> is a classic delivery risk — the kind of gap requirements analysis is meant to
> surface early.
