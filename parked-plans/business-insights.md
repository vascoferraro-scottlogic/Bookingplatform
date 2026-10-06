# `#business-insights` — Tenant-facing business analytics

**Size**: M (a few sessions)

**Intent**: Give club admins actionable visibility into their club's
health — bookings, revenue, members, operations. The existing
`/dashboard/analytics` covers product analytics (page views, feature
usage); this is *business* analytics built on transactional data.

**Route**: `/dashboard/insights` — feature-gated behind `businessInsights`.

---

## Phase A — Bookings & Revenue (core)

Single page with KPI cards + recharts charts, server-side aggregation.

| Widget | Data source | Chart |
|---|---|---|
| Bookings over time | `Booking` grouped by date | LineChart |
| Occupancy rate | booked slots ÷ available slots/day | KPI % card |
| Revenue trend | `BookingPayment` (PAID) summed by date | LineChart |
| Peak hours heatmap | `BookingSlot.timeSlot` × day-of-week | Grid cells |
| Cancellation rate | CANCELLED ÷ total bookings | KPI card |
| Top bookers | `Booking` grouped by userId, top 10 | Table |

**API**: `GET /api/insights/bookings?period={7d|30d|90d}`

## Phase B — Members & Engagement

| Widget | Data source | Chart |
|---|---|---|
| Active member trend | `User` count by `createdAt` bucket | LineChart |
| New registrations | `User` grouped by week/month | BarChart |
| Member activity | User → Booking/Message/Event counts | Stacked BarChart |
| Dormant members | Users with no activity in 90d | Table / count card |

**API**: `GET /api/insights/members?period={7d|30d|90d}`

## Phase C — Operations

| Widget | Data source | Chart |
|---|---|---|
| Task completion rate | `MaintenanceTask` CLOSED ÷ total | KPI card |
| Avg time-to-close | updatedAt − createdAt for CLOSED | KPI card |
| Tasks by category | grouped by `category` | BarChart |
| Green utilisation | `BookingSlot` per green ÷ available | BarChart |
| Event capacity fill | `Event` attendance/capacity | BarChart |

**API**: `GET /api/insights/operations?period={7d|30d|90d}`

## Phase D — Platform-level (PLATFORM_ADMIN only, optional)

Cross-tenant benchmarks on `/dashboard/platform/insights`.

| Widget | Data source |
|---|---|
| Platform growth | Aggregate tenant/user/booking counts |
| Tenant health scorecards | Composite activity score |
| Revenue per tenant | BookingPayment + TenantPayment |

---

## Implementation notes

- **No new Prisma models** — queries Booking, BookingSlot, BookingPayment,
  User, MaintenanceTask, Event.
- **Recharts** v3.8.1 already installed.
- **Pattern**: mirrors `/api/tracking/stats` (server-side aggregation,
  period filter, tenant scoping, role gate).
- **i18n**: keys in `common` namespace under `insights` object.
- **Feature flag**: `businessInsights` — add to `enable-all-flags.ts`.
- Occupancy denominator is initially simple (slots booked today ÷ total
  rinks × time slots). Refine later with season/opening-hours data.

## Status as of 2026-05-10

**Shipped**:
- Phases A–C (tenant-level bookings, members, operations) — 27 tests.
- Platform-admin enterprise MI (9-domain KPI dashboard) — 8 tests.
  Covers adoption, revenue (by country), churn, operations, agents
  (detector chat→task), federation/funding, onboarding pipeline,
  language/locale, feature usage (by tenant/country).
- All on branch `feat/business-insights`, 4 commits, build green, 511 tests total.

**Remaining**: materialised daily snapshots (v2, only if query latency
becomes a problem at scale), tenant health scorecards.
