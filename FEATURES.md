
# Club Management Platform — Feature Catalogue

White-label SaaS platform for bowling clubs worldwide. Platform earns subscription revenue from clubs; clubs opt in/out of modules and configure their own branding, fees, events, and opening times. Events can be public or members-only; clubs can share events with and from other clubs. Clubs that form federations can allow cross-club membership access.

Status key: **Complete** — shipped to main · **WIP** — actively in development · **Planned** — on the roadmap


---

## Core Platform

| Feature | Status | Description |
|---------|--------|-------------|
| Multi-tenant hosting | Complete | White-label clubs with isolated data, per-tenant branding, and independent configuration |
| Tenant resolution | Complete | Incoming requests routed to the correct club context by subdomain or slug |
| Role-based access | Complete | Five roles: guest, user, maintenance, tenant admin, platform admin |
| Permission groups | Complete | Custom permission bundles assignable to members; finer-grained than roles alone |
| Federations | Complete | Cross-club membership sharing — members of one club can access a federated club |
| Public landing | Complete | Anonymous visitors see neutral platform content; authenticated users see their club branding |
| Acquisition pipeline | Complete | Lead capture, application queue, platform approval, and automated club provisioning |
| Onboarding wizard | Complete | 10-chapter guided setup flow with go-live transition |
| Platform admin | Complete | Superadmin console for tenant management, feature-flag toggles, and platform payments overview |
| Feature flags | Complete | Per-tenant runtime module toggles; controllable from the platform admin console without a deployment |

## Bookings

| Feature | Status | Description |
|---------|--------|-------------|
| Availability grid | Complete | Date-picker → green/rink grid showing open and booked slots |
| Multi-green support | Complete | Each club configures multiple greens, each with multiple rinks |
| Booking workflow | Complete | Lifecycle: requested → approved → reserved → confirmed → cancelled/refunded |
| Waiting list | Complete | First waiter is auto-assigned and notified when a slot is cancelled; remaining waiters unaffected |
| Season enforcement | Complete | Configurable season window; bookings outside season or outside opening hours are rejected |
| Cancellation policy | Complete | Self-service cancellation up to 48 hours before play; admin-only within that window |
| Admin override | Complete | Admins can force-book conflicting slots with a mandatory reason, notified to affected parties |
| No-show outcome | Complete | Admins can mark a past confirmed booking as a no-show; records ground truth for the ML model |
| No-show prediction | Complete | ML model (Python sidecar) scores upcoming bookings by no-show risk; flags bookings at ≥40% probability for a proactive reminder; non-LLM agent emits reminder proposals into the admin inbox |
| Multi-slot booking | Planned | Select multiple slots in one transaction with aggregate pricing |

## Payments

| Feature | Status | Description |
|---------|--------|-------------|
| Booking payments | Complete | Checkout on booking confirmation; automatic refund on cancellation |
| Payment webhook receiver | Complete | Processes provider callbacks with signature verification and full idempotency |
| Tenant-configurable pricing | Complete | Each club sets its own per-slot booking fee |
| Platform billing | WIP | Platform subscription model, invoice generation, and financial dashboards for the platform operator |

## Content Management

| Feature | Status | Description |
|---------|--------|-------------|
| Headless CMS | Complete | Landing page sections with draft → review → published → archived lifecycle |
| Section types | Complete | Hero, about, photo, map, and contact blocks; each can be individually shown or hidden |

## Events

| Feature | Status | Description |
|---------|--------|-------------|
| Event management | Complete | Full create/edit/delete for structured events with category, format, capacity, and entry fee |
| Draft → published lifecycle | Complete | Simple two-state publish/unpublish workflow |
| Visibility control | Complete | Events can be members-only or public; public events visible to unauthenticated visitors |
| Cross-club event sharing | Complete | Outbound and inbound opt-in flags let clubs share upcoming events with each other |
| Weather widget | Complete | Venue weather forecast displayed on the booking page using the club's location |
| Midge forecast | Planned | UK midge-risk badge on the weather widget; GB/NI clubs only |

## Live Streaming

| Feature | Status | Description |
|---------|--------|-------------|
| WebRTC broadcasting | Complete | Admin/maintenance broadcast a live camera feed per rink from the browser |
| Tiered streaming plans | Complete | Bronze / Silver / Gold tiers with concurrent stream limits and archive retention periods |
| Stream visibility | Complete | Streams are members-only or public; private streams support time-limited shareable tokens |
| Viewer metrics | Complete | Per-stream and aggregate stats: viewer counts, watch duration, and device breakdown |
| Live notifications | Complete | Members notified when a stream goes live, delivered as real-time in-app push |
| Stream lifecycle | Complete | IDLE → LIVE → ENDED → ARCHIVED with concurrent limit enforcement per tier |

## Messaging

| Feature | Status | Description |
|---------|--------|-------------|
| Channels | Complete | Public, private, group, and direct-message channels per club |
| Real-time delivery | Complete | Messages pushed to connected clients in real time |
| Admin channel management | Complete | Tenant admins create, rename, and delete channels |
| Tenant isolation | Complete | Message operations enforce club boundaries; cross-tenant access is rejected |

## Maintenance

| Feature | Status | Description |
|---------|--------|-------------|
| Task management | Complete | Submit, assign, start, close, and reopen maintenance tasks with timestamped notes |
| Categories and priority | Complete | Seven task categories (rink surface, equipment, safety, etc.) and four priority levels |
| Role-scoped views | Complete | Maintenance staff see their own tasks; admins see all |

## Agents & Automation

| Feature | Status | Description |
|---------|--------|-------------|
| Chat triage agent | Complete | Classifies member messages by category and auto-creates maintenance tasks for safety/facility/grounds issues |
| Task automation agent | Complete | Rule engine that evaluates task conditions and executes actions: auto-assign, escalate, notify, close stale |
| Funding applications | Complete | Eligibility scoring against a grant database with AI-assisted drafting of applications |

## Analytics

| Feature | Status | Description |
|---------|--------|-------------|
| Feature tracking | Complete | Page views, feature usage, and interactions captured for all visitors (anonymous and authenticated) |
| Analytics dashboard | Complete | Traffic charts, browser and device breakdown, top pages, and feature-usage ranking |
| Business insights | WIP | Bookings trend, revenue, occupancy rate, cancellation rate, peak hours, and member activity for tenant admins; platform-level MI for platform admin |

## Authentication

| Feature | Status | Description |
|---------|--------|-------------|
| Login | Complete | Credentials-based login |
| Registration | Complete | Email and password self-registration |
| Password reset | Planned | Token-based forgot/reset flow (forgot-password page exists; reset-password page outstanding) |

## Audit Trail

| Feature | Status | Description |
|---------|--------|-------------|
| Audit log | Complete | Every significant action recorded with actor, role, club, entity, and timestamp |
| PII access tracking | Complete | Explicit flag on audit events where personal data was surfaced |
| Role-scoped audit dashboard | Complete | Users see own history; tenant admins see club activity; platform admins see everything |

## Progressive Web App

| Feature | Status | Description |
|---------|--------|-------------|
| Installable PWA | Complete | Manifest, service worker, offline page, and install prompt |

## Internationalisation

| Feature | Status | Description |
|---------|--------|-------------|
| Multi-locale support | WIP | Four locales (English, Welsh, French, Scottish Gaelic); infrastructure and string extraction shipped; translations and public-facing pages in progress |

## Charity (UK/NI)

| Feature | Status | Description |
|---------|--------|-------------|
| Charity accounts | Complete | Gated to UK/NI clubs with charity-eligible org type; ledger with receipts, payments, funds, and lockable financial years |
| Chart of accounts | Complete | Auto-seeded receipt and payment categories tuned for bowling clubs; unrestricted/restricted/designated funds |
| Receipts & Payments report | Complete | R&P matrix and Statement of Assets & Liabilities with CSV export for the regulator's annual return |
| TAR wizard | Complete | Guided Trustees' Annual Report with AI-assisted drafting for all three UK/NI regulators (CC E&W, OSCR, CCNI) |
| Organisation KYC | Complete | Onboarding chapter captures country, legal form, and financial year-end; auto-enables charity module for eligible org types |
| Document uploads for TAR | Planned | Upload supporting documents (constitution PDFs, prior submissions) to feed into the TAR LLM context |

## Help Centre

| Feature | Status | Description |
|---------|--------|-------------|
| Help articles | Complete | Browse-by-category index with full-text search, audience filtering (tenant admin / platform admin), and locale fallback |
| Article overrides | Complete | Tenant admins customise or hide individual help articles (feature-flag gated) |
| Contextual help hints | Complete | Inline help icons on dashboard pages that deep-link to the relevant article |