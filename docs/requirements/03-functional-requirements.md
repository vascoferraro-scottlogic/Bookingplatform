# 03 — Functional Requirements

*Tier: Functional · Traces up to: [HLBRs](02-business-requirements-HLBR.md)*

Each requirement is a testable **"the system shall…"** statement. Fields:
*Priority* (MoSCoW) · *Status* (Implemented / WIP / Planned) · *Source* (parent
HLBR). A few requirements carry a short *Note* that flags a known subtlety —
most are left clean on purpose so you can find the subtleties yourself.

**Area index**

| Prefix | Area | Source HLBR |
|--------|------|-------------|
| [FR-TEN](#fr-ten--tenancy--resolution) | Tenancy & resolution | BR-01, BR-02 |
| [FR-SEC](#fr-sec--access-control--impersonation) | Access control & impersonation | BR-03, BR-06 |
| [FR-FLAG](#fr-flag--feature-flags) | Feature flags | BR-02, BR-03 |
| [FR-ONB](#fr-onb--acquisition--onboarding) | Acquisition & onboarding | BR-04 |
| [FR-BOOK](#fr-book--bookings) | Bookings | BR-08, BR-16 |
| [FR-PAY](#fr-pay--payments) | Payments | BR-09 |
| [FR-BIL](#fr-bil--platform-billing) | Platform billing | BR-05 |
| [FR-MNT](#fr-mnt--maintenance) | Maintenance | BR-10 |
| [FR-CMS](#fr-cms--content-management) | Content management | BR-11 |
| [FR-EVT](#fr-evt--events) | Events | BR-11, BR-16 |
| [FR-STR](#fr-str--live-streaming) | Live streaming | BR-12 |
| [FR-MSG](#fr-msg--messaging) | Messaging | BR-12 |
| [FR-NTF](#fr-ntf--notifications) | Notifications | BR-12 |
| [FR-AGT](#fr-agt--agents--automation) | Agents & automation | BR-10, BR-13 |
| [FR-CHA](#fr-cha--charity--funding) | Charity & funding | BR-14 |
| [FR-ANL](#fr-anl--analytics--insights) | Analytics & insights | BR-15 |
| [FR-SITE](#fr-site--site-health--guidance) | Site health & guidance | BR-13, BR-15 |
| [FR-ADV](#fr-adv--advertising-marketplace) | Advertising marketplace | BR-19 |
| [FR-FED](#fr-fed--federations) | Federations | BR-16 |
| [FR-AUD](#fr-aud--audit-trail) | Audit trail | BR-07 |
| [FR-AUTH](#fr-auth--authentication) | Authentication | BR-06 |
| [FR-SET](#fr-set--settings--tenant-lifecycle) | Settings & tenant lifecycle | BR-03 |
| [FR-RPT](#fr-rpt--reports--exports) | Reports & exports | BR-07, BR-15 |
| [FR-I18N](#fr-i18n--internationalisation) | Internationalisation | BR-17 |
| [FR-HLP](#fr-hlp--help-centre) | Help centre | BR-18 |
| [FR-PWA](#fr-pwa--progressive-web-app) | Progressive web app | BR-12 |

---

## FR-TEN — Tenancy & resolution

**FR-TEN-001 — Tenant resolution**
*Must · Implemented · BR-01*
The system **shall** resolve every incoming request to exactly one tenant
context, identified by the request's subdomain or slug, before any tenant-scoped
data is read or written.

**FR-TEN-002 — Data isolation on read**
*Must · Implemented · BR-01*
The system **shall** scope every tenant-scoped query to the resolved tenant, so
that a query can never return another tenant's records.

**FR-TEN-003 — Data isolation on write**
*Must · Implemented · BR-01*
The system **shall** reject any create/update/delete whose target resource
belongs to a tenant other than the caller's resolved tenant context.

**FR-TEN-004 — Neutral public landing**
*Should · Implemented · BR-01*
The system **shall** present neutral platform content to an anonymous visitor
with no resolved club context, and the club's branding to an authenticated
member of that club.

**FR-TEN-005 — Per-tenant branding & configuration**
*Should · Implemented · BR-02*
The system **shall** render each tenant's own branding and apply its own
configuration (opening hours, season, fees, locale) independently of every other
tenant.

---

## FR-SEC — Access control & impersonation

**FR-SEC-001 — Five roles**
*Must · Implemented · BR-06*
The system **shall** recognise exactly five roles — `GUEST`, `USER`,
`MAINTENANCE`, `TENANT_ADMIN`, `PLATFORM_ADMIN` — and evaluate authorisation
against the caller's role.

**FR-SEC-002 — Tenant role ladder**
*Must · Implemented · BR-06*
Within the tenant plane the system **shall** treat roles as an ascending ladder
`GUEST < USER < MAINTENANCE < TENANT_ADMIN`, such that a role satisfies any gate
at or below its rank.

**FR-SEC-003 — Orthogonal platform plane**
*Must · Implemented · BR-06*
The system **shall** treat `PLATFORM_ADMIN` as a separate plane with **no
implicit tenant powers**: a platform-admin role shall satisfy *only* a
platform-admin gate, and shall not satisfy any tenant gate.
*Note:* this is the inverse of what most graduates assume ("an admin can do
everything"). Read the statement carefully in both directions before accepting
it.

**FR-SEC-004 — Impersonation (acting-as)**
*Must · Implemented · BR-06*
The system **shall** allow a platform admin to act on behalf of a specific
tenant by assuming a tenant role (e.g. `TENANT_ADMIN`) scoped to that tenant,
recorded as an impersonation session.

**FR-SEC-005 — Effective vs real identity**
*Must · Implemented · BR-06, BR-07*
While impersonating, the system **shall** evaluate permissions against the
assumed (effective) role and impersonated tenant, while retaining the real user
id and real role (`PLATFORM_ADMIN`) for attribution.

**FR-SEC-006 — Impersonation scope limit**
*Must · Implemented · BR-01, BR-06*
The system **shall** confine an impersonating platform admin to the impersonated
tenant's data, so impersonation never becomes a cross-tenant backdoor.

**FR-SEC-007 — Permission groups**
*Should · Implemented · BR-06*
The system **shall** let a tenant admin define custom permission bundles and
assign them to members, granting permissions finer-grained than role alone.

**FR-SEC-008 — Dual gate (role OR permission)**
*Should · Implemented · BR-06*
Where a permission group grants a capability, the system **shall** authorise a
member who holds either the sufficient role **or** the granting permission.

**FR-SEC-009 — Platform-defined permission catalogue**
*Should · Implemented · BR-06*
The system **shall** define the catalogue of assignable permissions centrally
(spanning all domains), so that tenants compose groups from a platform-governed
set rather than inventing permissions; a tenant admin **shall** implicitly hold
all permissions.

---

## FR-FLAG — Feature flags

**FR-FLAG-001 — Per-tenant module toggles**
*Must · Implemented · BR-02*
The system **shall** enable or disable each capability module per tenant at
runtime, without a deployment.

**FR-FLAG-002 — Gate behind flag**
*Must · Implemented · BR-02*
The system **shall** deny access to a module's functionality (UI and API) when
that module's flag is off for the caller's tenant.
*Note:* "denied because the flag is off" and "denied because the role is
insufficient" are different failure modes — keep them distinct when analysing.

**FR-FLAG-003 — Platform-admin control**
*Should · Implemented · BR-03*
The system **shall** let a platform admin toggle any tenant's flags from the
platform console.

**FR-FLAG-004 — Vertical presets**
*Should · Implemented · BR-02*
On provisioning, the system **shall** apply a default flag set derived from the
tenant's selected vertical (e.g. bowls → bookings + maintenance; charity →
funding + charity accounts).

---

## FR-ONB — Acquisition & onboarding

**FR-ONB-001 — Lead capture**
*Must · Implemented · BR-04*
The system **shall** capture an enquiry from a prospective organisation as a
lead.

**FR-ONB-002 — Application queue**
*Must · Implemented · BR-04*
The system **shall** record a prospective organisation's application and place it
in a platform approval queue.

**FR-ONB-003 — Platform approval**
*Must · Implemented · BR-04*
The system **shall** allow a platform admin to approve or reject a queued
application.

**FR-ONB-004 — Provisioning on approval**
*Must · Implemented · BR-04*
On approval, the system **shall** automatically provision a new tenant with
default configuration and vertical-appropriate feature flags.

**FR-ONB-005 — Guided wizard**
*Must · Implemented · BR-04*
The system **shall** guide a newly provisioned tenant through a ten-chapter setup
wizard.

**FR-ONB-006 — Resumable progress**
*Should · Implemented · BR-04*
The system **shall** persist onboarding progress so a tenant can leave and resume
the wizard without losing completed chapters.

**FR-ONB-007 — Organisation KYC drives capability**
*Must · Implemented · BR-04, BR-14*
The onboarding KYC chapter **shall** capture country, legal form and financial
year-end, and **shall** auto-enable the charity module when the captured org type
is charity-eligible.

**FR-ONB-008 — Go-live transition**
*Must · Implemented · BR-04*
The system **shall** transition a tenant from `ONBOARDING` to `ACTIVE` at go-live,
after which the tenant's capabilities are available to its members.

---

## FR-BOOK — Bookings

**FR-BOOK-001 — Availability grid**
*Must · Implemented · BR-08*
The system **shall** display, for a chosen date, a grid of the tenant's greens
and rinks showing which slots are open and which are booked.

**FR-BOOK-002 — Multi-green / multi-rink**
*Must · Implemented · BR-08*
The system **shall** support a tenant configuring multiple greens, each with
multiple rinks, as independently bookable resources.

**FR-BOOK-003 — Booking lifecycle**
*Must · Implemented · BR-08*
The system **shall** move a booking through the lifecycle
`requested → approved → reserved → confirmed → cancelled/refunded`, permitting
only valid transitions.

**FR-BOOK-004 — Season enforcement**
*Must · Implemented · BR-08*
The system **shall** reject a booking for a green on a date outside that green's
configured season window.

**FR-BOOK-005 — Season configuration modes**
*Must · Implemented · BR-08*
The system **shall** determine a green's season from, in precedence order: an
`allWeather` flag (always open), a per-year override, a recurring start/end
month-day pair, or — if none is set — treat the green as always open.

**FR-BOOK-006 — Season wrap-around**
*Should · Implemented · BR-08*
The system **shall** correctly handle a season window that wraps across the
year boundary (end month-day earlier than start month-day), so a January date
can fall inside the previous year's November→February window.
*Note:* wrap-around is a textbook source of boundary ambiguity.

**FR-BOOK-007 — Opening-hours enforcement**
*Must · Implemented · BR-08*
The system **shall** reject a booking whose time slot falls outside the tenant's
configured opening hours.

**FR-BOOK-008 — Intra-request slot dedupe**
*Must · Implemented · BR-08*
The system **shall** reject an entire booking request if the same rink and time
slot appears more than once within it, so a double-tap cannot create a
self-clash.

**FR-BOOK-009 — Clash rejection**
*Must · Implemented · BR-08*
The system **shall** reject a booking for a slot already held by a confirmed or
reserved booking, unless an authorised admin override is supplied.

**FR-BOOK-010 — Admin override**
*Should · Implemented · BR-08*
The system **shall** allow a tenant admin to force a booking over a conflicting
slot only when a mandatory override reason is supplied, and **shall** notify the
affected parties.

**FR-BOOK-011 — Waiting list**
*Should · Implemented · BR-08*
When a confirmed booking is cancelled, the system **shall** auto-assign the first
waiter on that slot's waiting list and notify them, leaving remaining waiters in
place.
*Note:* does the first waiter get a *choice*? Read it literally and decide
whether that's a requirement gap.

**FR-BOOK-012 — Self-service cancellation outside window**
*Must · Implemented · BR-08*
The system **shall** allow a member to cancel their own confirmed booking
without admin involvement only when the cancellation is made **more than 48
hours before** the booked play time.

**FR-BOOK-013 — Admin-only cancellation inside window**
*Must · Implemented · BR-08*
Within 48 hours of the booked play time, the system **shall** permit cancellation
of a confirmed booking only by a tenant admin.
*Note:* pair with FR-BOOK-012 — the exact 48h instant is ambiguous: is a
cancellation made *at precisely* 48h inside or outside the member's window?

**FR-BOOK-014 — No-show marking**
*Should · Implemented · BR-08, BR-13*
The system **shall** let a tenant admin mark a past confirmed booking as a
no-show, recording it as ground truth for the no-show model.

**FR-BOOK-015 — No-show prediction**
*Could · Implemented · BR-08, BR-13*
The system **shall** score each upcoming booking for no-show risk using the ML
sidecar, and flag bookings at or above **40%** predicted probability for a
proactive reminder.

**FR-BOOK-016 — Reminder proposal**
*Could · Implemented · BR-13*
For a flagged high-risk booking, the system **shall** emit a reminder proposal
into the admin inbox rather than acting automatically.

**FR-BOOK-017 — Cross-club (federation) booking**
*Could · Implemented · BR-08, BR-16*
The system **shall** allow a member to book at a partner club only when: the home
tenant has the `federation` feature enabled; the target club exists; the member
holds the `federation_book_at_partners` permission at the home club; and the two
clubs share a common **active** federation. Otherwise the booking **shall** be
rejected with a reason.

**FR-BOOK-018 — Cross-club provenance**
*Should · Implemented · BR-16*
For a cross-club booking, the system **shall** record the booking against the
target club while retaining the booking member's home club as provenance.

**FR-BOOK-019 — Multi-slot single-transaction booking**
*Could · Planned · BR-08*
The system **shall** allow selecting multiple slots in one transaction with
aggregate pricing.

**FR-BOOK-020 — Generalised facility vocabulary**
*Could · Planned · BR-08, BR-02*
The system **shall** generalise the "Green / Rink" domain vocabulary to
"Facility / Resource", so the same booking engine serves non-bowls verticals.

**FR-BOOK-021 — Facility-type discriminator**
*Could · Planned · BR-08, BR-02*
The system **shall** distinguish facility types via a `facilityType`
discriminator (e.g. bowls green, golf hole, cricket pitch), enabling real
bookings for golf and cricket clubs on the shared engine.

---

## FR-PAY — Payments

**FR-PAY-001 — Checkout on confirmation**
*Must · Implemented · BR-09*
The system **shall** initiate payment checkout when a booking that carries a fee
is confirmed.

**FR-PAY-002 — Automatic refund on cancellation**
*Must · Implemented · BR-09*
The system **shall** automatically refund a paid booking when it is cancelled
under qualifying conditions.
*Note:* "qualifying conditions" is under-specified here on purpose — what are
they? Cross-check with the cancellation policy (FR-BOOK-012/013).

**FR-PAY-003 — Webhook signature verification**
*Must · Implemented · BR-09*
The system **shall** reject any payment-provider webhook whose signature does not
verify.

**FR-PAY-004 — Webhook idempotency**
*Must · Implemented · BR-09*
The system **shall** process each payment webhook event at most once in effect,
so a replayed or duplicated callback does not double-apply.

**FR-PAY-005 — Tenant-configurable fee**
*Should · Implemented · BR-09*
The system **shall** let each tenant set its own per-slot booking fee, applied to
that tenant's bookings.

---

## FR-BIL — Platform billing

**FR-BIL-001 — Plan selection**
*Should · WIP · BR-05*
The system **shall** let a tenant select a subscription plan that sets its
recurring platform fee.

**FR-BIL-002 — Invoice generation**
*Should · WIP · BR-05*
The system **shall** generate platform invoices for tenant subscriptions.

**FR-BIL-003 — Operator financial dashboard**
*Should · WIP · BR-05*
The system **shall** present the platform operator with subscription and revenue
dashboards across tenants.

**FR-BIL-004 — Real provider integration**
*Could · Planned · BR-05*
The system **shall** integrate a real payment provider (e.g. Stripe/GoCardless)
with self-serve plan changes, proration and PDF invoices.

**FR-BIL-005 — Subscription plan catalogue**
*Should · Planned · BR-05*
The system **shall** maintain a catalogue of platform plans, each with a price,
trial length, included limits (members, greens, streaming tier) and default
feature set, which a tenant selects at onboarding or changes later.

**FR-BIL-006 — Tenant billing profile**
*Should · Planned · BR-05*
The system **shall** hold a per-tenant billing profile (plan, billing contact,
address, VAT number, payment method) with a billing status of `TRIAL`, `ACTIVE`,
`PAST_DUE`, `SUSPENDED` or `CANCELLED`, and current billing-period dates.

**FR-BIL-007 — Itemised invoices**
*Should · Planned · BR-05*
The system **shall** produce invoices composed of line items categorised by type
(platform subscription, streaming tier, add-on, credit, adjustment).

**FR-BIL-008 — Billing status drives access**
*Should · Planned · BR-05, BR-03*
The system **shall** reflect a tenant's billing status in its access (e.g. a
`SUSPENDED` tenant is restricted), consistent with the tenant-lifecycle rules in
FR-SET.
*Note:* which capabilities survive suspension is under-specified — a gap to
raise.

---

## FR-MNT — Maintenance

**FR-MNT-001 — Task lifecycle**
*Should · Implemented · BR-10*
The system **shall** allow a maintenance task to be submitted, assigned, started,
closed and reopened, each change timestamped with notes.

**FR-MNT-002 — Categories & priority**
*Should · Implemented · BR-10*
The system **shall** classify each task by one of seven categories (rink surface,
equipment, safety, etc.) and one of four priority levels.

**FR-MNT-003 — Role-scoped views**
*Should · Implemented · BR-10, BR-06*
The system **shall** show maintenance staff only their own assigned tasks, while
tenant admins see all of the tenant's tasks.

---

## FR-CMS — Content management

**FR-CMS-001 — Section lifecycle**
*Should · Implemented · BR-11*
The system **shall** move a landing-page content section through
`draft → review → published → archived`, showing only published sections to the
public.

**FR-CMS-002 — Section types**
*Should · Implemented · BR-11*
The system **shall** support hero, about, photo, map and contact section types,
each individually shown or hidden.

---

## FR-EVT — Events

**FR-EVT-001 — Event CRUD**
*Should · Implemented · BR-11*
The system **shall** let a tenant admin create, edit and delete structured events
with category, format, capacity and entry fee.

**FR-EVT-002 — Publish lifecycle**
*Should · Implemented · BR-11*
The system **shall** support a two-state draft/published lifecycle for events.

**FR-EVT-003 — Visibility control**
*Should · Implemented · BR-11*
The system **shall** allow each event to be members-only or public, showing
public events to unauthenticated visitors and withholding members-only events
from them.

**FR-EVT-004 — Cross-club sharing**
*Could · Implemented · BR-11, BR-16*
The system **shall** let a club opt in to sharing its events outbound and opt in
to displaying partner clubs' events inbound, independently.

**FR-EVT-005 — Weather widget**
*Could · Implemented · BR-11*
The system **shall** display a venue weather forecast on the booking page using
the tenant's configured location.

**FR-EVT-006 — Midge forecast**
*Could · Planned · BR-11*
The system **shall** display a UK midge-risk badge on the weather widget for
tenants whose country is GB or NI, gated on the `midgeForecast` flag.

---

## FR-STR — Live streaming

**FR-STR-001 — Broadcast per rink**
*Could · Implemented · BR-12*
The system **shall** let an admin or maintenance user broadcast a live camera
feed per rink from the browser.

**FR-STR-002 — Stream lifecycle**
*Could · Implemented · BR-12*
The system **shall** move a stream through `IDLE → LIVE → ENDED → ARCHIVED`.

**FR-STR-003 — Tiered concurrency & retention**
*Could · Implemented · BR-12*
The system **shall** enforce per-tier (Bronze/Silver/Gold) limits on concurrent
streams and archive retention periods.

**FR-STR-004 — Concurrency limit enforcement**
*Could · Implemented · BR-12*
The system **shall** refuse to start a stream that would exceed the tenant tier's
concurrent-stream limit.

**FR-STR-005 — Visibility & share tokens**
*Could · Implemented · BR-12*
The system **shall** support members-only or public streams, with private streams
offering time-limited shareable access tokens.

**FR-STR-006 — Viewer metrics**
*Could · Implemented · BR-12, BR-15*
The system **shall** record per-stream and aggregate viewer counts, watch
duration and device breakdown.

**FR-STR-007 — Go-live notification**
*Could · Implemented · BR-12*
The system **shall** notify members in real time when a stream goes live.

---

## FR-MSG — Messaging

**FR-MSG-001 — Channel types**
*Should · Implemented · BR-12*
The system **shall** support public, private, group and direct-message channels
per tenant.

**FR-MSG-002 — Real-time delivery**
*Should · Implemented · BR-12*
The system **shall** push messages to connected clients in real time.

**FR-MSG-003 — Admin channel management**
*Should · Implemented · BR-12*
The system **shall** let a tenant admin create, rename and delete channels.

**FR-MSG-004 — Tenant isolation of messages**
*Must · Implemented · BR-01, BR-12*
The system **shall** reject any messaging operation that crosses a tenant
boundary.

---

## FR-NTF — Notifications

**FR-NTF-001 — Real-time in-app notifications**
*Should · Implemented · BR-12*
The system **shall** deliver in-app notifications to members in real time for
events that concern them (e.g. stream go-live, waiting-list assignment, override
notice).

**FR-NTF-002 — Web push & email digests**
*Could · Planned · BR-12*
The system **shall** deliver web-push notifications and email digests with
per-channel preferences.

---

## FR-AGT — Agents & automation

**FR-AGT-001 — Chat triage agent**
*Should · Implemented · BR-10, BR-13*
The system **shall** classify member messages by category and auto-create a
maintenance task for messages identified as safety, facility or grounds issues.

**FR-AGT-002 — Task automation rule engine**
*Should · Implemented · BR-10, BR-13*
The system **shall** evaluate configured conditions on tasks and execute matching
actions: auto-assign, escalate, notify, or close-stale.

**FR-AGT-003 — No-show reminder agent**
*Could · Implemented · BR-13*
The system **shall** emit no-show reminder proposals into the admin inbox for
high-risk upcoming bookings (see FR-BOOK-015/016), without auto-sending.

**FR-AGT-004 — Funding eligibility & drafting**
*Should · Implemented · BR-13, BR-14*
The system **shall** score a tenant's eligibility against a grant database and
offer AI-assisted drafting of the resulting application.

**FR-AGT-005 — Scheduler agent**
*Could · Planned · BR-13*
The system **shall** provide a scheduling agent that proposes actions at
configured times (e.g. recurring reminders, periodic housekeeping).

**FR-AGT-006 — Anomaly agent**
*Could · Planned · BR-13*
The system **shall** detect anomalies in a tenant's activity and raise a proposal
for admin attention.

**FR-AGT-007 — Churn-warning agent**
*Could · Planned · BR-13, BR-15*
The system **shall** flag members or tenants at risk of churn and propose
intervention.

**FR-AGT-008 — Agent cost capping**
*Should · Planned · BR-13*
The system **shall** enforce a per-tenant agent cost budget, so agent LLM spend
cannot exceed the tenant's configured cap.

**FR-AGT-009 — Self-supersede stale proposals**
*Should · Planned · BR-13*
On each run, the system **shall** supersede an agent's own stale pending
proposals whose topic has been refreshed, so the admin inbox does not accumulate
duplicates.

**FR-AGT-010 — Propose-not-publish discipline**
*Should · Implemented · BR-13*
The system **shall** route high-impact agent outputs (reminders, drafts,
task changes) through a proposal that a human approves, rather than acting
automatically.
*Note:* the triage agent currently writes tasks directly; migrating it to the
proposal model is Planned (`#triager-proposals`). That is an inconsistency with
this requirement worth flagging.

---

## FR-CHA — Charity & funding

**FR-CHA-001 — Charity module gating**
*Must · Implemented · BR-14, BR-02*
The system **shall** enable charity accounts only for tenants whose country is
UK/NI **and** whose legal form is charity-eligible.

**FR-CHA-002 — Receipts & payments ledger**
*Must · Implemented · BR-14*
The system **shall** maintain a ledger of receipts and payments categorised
against a chart of accounts, across unrestricted, restricted and designated
funds.

**FR-CHA-003 — Financial-year lock**
*Must · Implemented · BR-14*
The system **shall** allow a financial year to be locked, after which its entries
cannot be altered, and support an unlock cascade where dependent outputs are
invalidated.

**FR-CHA-004 — Receipts & Payments report**
*Must · Implemented · BR-14*
The system **shall** produce a Receipts & Payments account and a Statement of
Assets & Liabilities, exportable as CSV for the regulator's annual return.

**FR-CHA-005 — TAR wizard**
*Must · Implemented · BR-14*
The system **shall** guide trustees through a Trustees' Annual Report with
AI-assisted drafting, producing output appropriate to the tenant's regulator
(CC E&W, OSCR, or CCNI).

**FR-CHA-006 — Readiness warnings**
*Should · Implemented · BR-14*
The system **shall** warn when prerequisites for a statutory output are not met
(e.g. unlocked year, missing data).

**FR-CHA-007 — TAR document uploads**
*Could · Planned · BR-14*
The system **shall** let trustees upload supporting documents to feed the TAR
drafting context.

---

## FR-ANL — Analytics

## FR-ANL — Analytics & insights

**FR-ANL-001 — Usage tracking**
*Could · Implemented · BR-15*
The system **shall** capture page views, feature usage and interactions for all
visitors, anonymous and authenticated.

**FR-ANL-002 — Analytics dashboard**
*Could · Implemented · BR-15*
The system **shall** present traffic charts, browser/device breakdown, top pages
and feature-usage ranking.

**FR-ANL-003 — Business insights: bookings & revenue**
*Could · WIP · BR-15*
The system **shall** present tenant admins with bookings trend, revenue,
occupancy rate, cancellation rate, peak hours and top bookers over a selectable
period, gated on the `businessInsights` flag.

**FR-ANL-004 — Business insights: members & engagement**
*Could · Planned · BR-15*
The system **shall** present active-member trend, new registrations, member
activity and dormant-member counts.

**FR-ANL-005 — Business insights: operations**
*Could · Planned · BR-15, BR-10*
The system **shall** present task completion rate, average time-to-close, tasks
by category, green utilisation and event capacity fill.

**FR-ANL-006 — Platform-level insights**
*Could · Planned · BR-15, BR-03*
The system **shall** present the platform operator with cross-tenant benchmarks,
tenant health scorecards and revenue-per-tenant.

---

## FR-SITE — Site health & guidance

**FR-SITE-001 — Content go-live gate**
*Should · Planned · BR-11, BR-04*
The system **shall** prevent a tenant going live until it has published at least
one hero section and one other content section, so no club launches with an empty
public site.

**FR-SITE-002 — Site Advisor agent**
*Could · Planned · BR-13, BR-15*
The system **shall** evaluate a tenant's site weekly across enabled modules
(content, traffic, events, streaming), produce a composite site score, and emit
guidance suggestions, stale-content warnings, benchmark insights and conversion
tips to the tenant admin.

**FR-SITE-003 — Regional benchmarking**
*Could · Planned · BR-15*
The system **shall** benchmark a tenant against anonymised regional medians so
guidance is evidence-backed rather than a generic checklist.

**FR-SITE-004 — Platform Health agent**
*Could · Planned · BR-13, BR-15*
The system **shall** evaluate the estate weekly for struggling clubs, churn risk,
success patterns and stalled onboardings, and surface intervention signals to the
platform operator.

**FR-SITE-005 — Evaluator extensibility**
*Could · Planned · BR-13*
The system **shall** load site/health evaluators per feature flag, so a new
capability can ship its own evaluator without changing the agents.

---

## FR-ADV — Advertising marketplace

**FR-ADV-001 — Club-direct ad sales**
*Could · Planned · BR-19*
The system **shall** let a tenant sell advertising placements ("hoardings") on
its own site to local advertisers, direct-sold only (no real-time bidding, no
third-party tags).

**FR-ADV-002 — Ad-serving substrate**
*Could · Planned · BR-19*
The system **shall** serve and display sold advertising placements on tenant
pages.

**FR-ADV-003 — Platform-brokered campaigns**
*Could · Planned · BR-19, BR-03*
The system **shall** let the platform broker multi-club advertising campaigns
across tenants that opt in to platform participation.

**FR-ADV-004 — Advertising agents**
*Could · Planned · BR-19, BR-13*
The system **shall** provide propose-not-publish advertising agents for prospect
identification, creative drafting and pricing guidance.

**FR-ADV-005 — Participation opt-in**
*Could · Planned · BR-19*
The system **shall** let each tenant control whether it participates in
platform-brokered advertising.

---

## FR-FED — Federations

**FR-FED-001 — Federation lifecycle**
*Could · Implemented · BR-16*
The system **shall** support creating a federation and managing member clubs'
join/invite/accept/leave/dissolve over its lifecycle, with federation status
(e.g. ACTIVE) governing whether cross-club actions are permitted.

**FR-FED-002 — Cross-club membership access**
*Could · Implemented · BR-16*
The system **shall** let a member of one federated club act as a member of
another federated club for permitted actions, subject to permission gating
(`federation.book_at_partners`).

**FR-FED-003 — Clash warnings**
*Could · Implemented · BR-16*
The system **shall** raise a soft, confirm-to-proceed warning for a cross-club
booking that clashes with the member's booking at another club: a same-time-slot
clash (`CROSS_CLUB_CLASH`) and an adjacent-slot-at-another-club case
(`CROSS_CLUB_CONSECUTIVE`). These **shall not** hard-block, and **shall not**
apply to intra-club multi-rink bookings.

**FR-FED-004 — Configurable cross-club billing mode**
*Could · Planned · BR-16, BR-09*
The system **shall** let a federation set how partner-club bookings are charged:
`FREE_ACCESS`, `REDUCED_RATE` or `HOST_CLUB_RATE`.

**FR-FED-005 — Federation guardrails**
*Could · Planned · BR-16*
The system **shall** enforce platform guardrails on federations: a configurable
maximum of clubs per federation (default 10), federations per club (default 3),
and an invitation rate limit (default 5/day), and **shall** let a platform admin
suspend or dissolve a federation.

---

## FR-AUD — Audit trail

**FR-AUD-001 — Record significant actions**
*Must · Implemented · BR-07*
The system **shall** record every significant action with actor, role, tenant,
affected entity and timestamp.

**FR-AUD-002 — PII-access flag**
*Must · Implemented · BR-07*
The system **shall** explicitly flag audit events on which personal data was
surfaced.

**FR-AUD-003 — Impersonation attribution**
*Must · Implemented · BR-07, BR-06*
The system **shall** record, for an impersonated action, both the real actor
(the platform admin) and the acting-as role/tenant.

**FR-AUD-004 — Role-scoped audit visibility**
*Must · Implemented · BR-07, BR-06*
The system **shall** show a user only their own history, a tenant admin the
tenant's activity, and a platform admin everything.

---

## FR-AUTH — Authentication

**FR-AUTH-001 — Credential login**
*Must · Implemented · BR-06*
The system **shall** authenticate a user by email and password.

**FR-AUTH-002 — Self-registration**
*Must · Implemented · BR-06*
The system **shall** allow a visitor to self-register with email and password.

**FR-AUTH-003 — Password reset**
*Should · Planned · BR-06*
The system **shall** allow a user to request and complete a token-based password
reset.
*Note:* the forgot-password page exists but the reset page is outstanding — a
**partially built** requirement. Consider what a user reaches today at the end of
the flow.

---

## FR-SET — Settings & tenant lifecycle

**FR-SET-001 — Tenant settings hub**
*Should · Planned · BR-03*
The system **shall** provide a tenant settings hub where a tenant admin manages
branding, opening hours, season, locale and booking fee in one place.

**FR-SET-002 — Suspension & reactivation**
*Should · Planned · BR-03*
The system **shall** let a platform admin suspend and later reactivate a tenant,
with suspension restricting the tenant's access per the billing/lifecycle rules.
*Note:* exactly what a suspended tenant can still do is unspecified here and in
FR-BIL-008 — a gap worth raising.

**FR-SET-003 — Member self-service**
*Should · Planned · BR-03*
The system **shall** let a member manage their own profile and preferences
without admin involvement.

---

## FR-RPT — Reports & exports

**FR-RPT-001 — CSV data exports**
*Could · Planned · BR-07, BR-15*
The system **shall** let a tenant admin export bookings, members, payments and
audit data as CSV.
*Note:* exports can contain personal data — the access-control expectation is in
NFR-05.

**FR-RPT-002 — Scheduled report email**
*Could · Planned · BR-15*
The system **shall** email a tenant admin a periodic (e.g. monthly) summary
report.

---

## FR-I18N — Internationalisation

**FR-I18N-001 — Multi-locale UI**
*Could · WIP · BR-17*
The system **shall** present its interface in one of four locales (English,
Welsh, French, Scottish Gaelic) driven by tenant/user locale.

**FR-I18N-002 — Locale fallback**
*Could · WIP · BR-17*
The system **shall** fall back to a default locale for strings not translated in
the selected locale.

**FR-I18N-003 — Localised public pages**
*Could · Planned · BR-17*
The system **shall** present a tenant's public-facing pages (landing, events) in
the tenant's locale, Welsh first.

**FR-I18N-004 — Translation coverage**
*Could · WIP · BR-17*
The system **shall** externalise all user-visible strings into per-namespace
locale files with a coverage check, so no raw key or missing-string placeholder
reaches the user.

---

## FR-HLP — Help centre

**FR-HLP-001 — Article index & search**
*Could · Implemented · BR-18*
The system **shall** present help articles by category with full-text search and
audience filtering (tenant admin / platform admin), with locale fallback.

**FR-HLP-002 — Article overrides**
*Could · Implemented · BR-18*
The system **shall** let a tenant admin customise or hide individual help
articles, gated on the relevant feature flag.

**FR-HLP-003 — Contextual hints**
*Could · Implemented · BR-18*
The system **shall** show inline help icons on dashboard pages that deep-link to
the relevant article.

---

## FR-PWA — Progressive web app

**FR-PWA-001 — Installable PWA**
*Could · Implemented · BR-12*
The system **shall** provide a web-app manifest, service worker, offline page and
install prompt so the product can be installed as an app.
