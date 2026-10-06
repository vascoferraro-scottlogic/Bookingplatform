# Vision — BookingPlatform

A **modular, multi-tenant SaaS platform for member organisations** — bowls, golf, and cricket clubs, registered charities, CIOs, and other community organisations. Organisations pay the platform for hosting; in return they get a capability bundle tailored to what they actually need:

- **Bookings** (greens, courses, pitches, slots, payments) — for facility-based organisations
- **Maintenance** (task triage, AI agent, groundskeeper tools) — for organisations with managed facilities
- **Charity & funding** (ledger, TAR reports, grant applications, AI-assisted drafting) — for UK-registered charities, CIOs, and CASCs
- A white-labelled public website (branding, content, events)
- Member-facing tools (chat, notifications, live streaming)
- Back-office tools (admin, audit, analytics, AI agents)

Capabilities are feature-flag-gated per tenant. A bowls club gets bookings + maintenance. A registered charity with no facilities gets funding + charity accounts. A golf club gets bookings + maintenance with a future facility vocabulary update. Every organisation pays a platform fee via the plan they select at onboarding.

## Future ambitions

- **Federations** — a member of club A can act as a member of club B
  (cross-club booking with configurable billing, clash warnings, peer
  agreements). Full design plan at `parked-plans/permission-groups.md`.
- **Facility generalisation** (`#facility-generalisation`) — generalise "Green / Rink" vocabulary to "Facility / Resource" with a facilityType discriminator, enabling golf holes, cricket pitches, and mixed-sport facilities to share the same booking engine.
- **Cross-club event sharing** (already partially built via
  `eventsShareExternal`)
- Globally distributed organisations with local config (locale, timezone, season dates)

## Operating model

**Platform-admin-runs-the-shop**: a small platform team onboards organisations, handles billing, and configures the platform; each organisation then self-manages within the boundaries set by its feature flags and subscription.

## North star

Any member organisation anywhere can sign up, self-onboard through a guided wizard tailored to their vertical, and be running their relevant capability bundle within a single session — with ongoing AI-powered guidance keeping their platform healthy and their admin load low.
