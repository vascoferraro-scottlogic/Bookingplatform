# Parked plan: Permission groups + Federation v1 (`#permission-groups`)

**Status as of 2026-05-05**: parked. Full 6-phase design complete. No code
written yet. No dependencies on in-flight features — can start on a
worktree alongside current work. Branch: `feature/permission-groups`.

## Why parked

Designed as a planning session. Implementation is independent of the
onboarding/charity work that was in flight at design time.

## What shipped

Nothing yet — design only (captured in `DECISIONS.md` 2026-05-05).

## What's left (refined plan)

### Architecture

1. **Permission groups** — club-defined named groups (e.g. "Trustees",
   "Greenkeepers", "Funding Committee") with platform-defined permission
   grants (~35 permissions across all domains). Existing roles remain as
   tier scaffold; TENANT_ADMIN = implicit all permissions. Custom groups
   sit at USER tier. Built-in groups seeded per tenant mirror legacy roles.

2. **Federation v1 is flat** — peer agreement between clubs; no hierarchy.
   Clubs self-organise (any TENANT_ADMIN creates + invites). Player
   mobility: federation members book at partner clubs with configurable
   billing (FREE_ACCESS / REDUCED_RATE / HOST_CLUB_RATE).

3. **Platform guardrails** — 10 clubs/federation (configurable), 3
   federations/club, 5 invites/day rate limit. Platform admin can
   suspend/dissolve. No booking quota. Self-service creation with
   platform notification.

4. **Cross-club booking clash warnings** — soft 409: same time slot at
   different club = `CROSS_CLUB_CLASH` ("did ye forget?"); adjacent slot
   at different club = `CROSS_CLUB_CONSECUTIVE` ("you'll need to travel").
   Both are confirm-to-proceed, no hard block. Does NOT apply intra-club
   (multi-rink = intentional).

5. **`federation.book_at_partners` is grantable** — clubs control which
   members get federation booking rights via permission groups.

### Implementation phases

- **C1** — Permission schema (PermissionGroup, PermissionGrant, GroupMember
  models; platform-defined permission enum; built-in group seeding)
- **C2** — Dual gate on routes (existing `assertEffectiveRoleOrFail` +
  new `assertPermissionOrFail`; new features opt into permissions,
  existing routes keep role-only gate)
- **C3** — Club UI for groups (`/dashboard/settings/groups`: create/edit
  groups, assign members, browse permissions)
- **C4** — Federation schema + lifecycle (Federation, FederationMembership
  models; create/invite/accept/leave/dissolve flows; platform guardrails)
- **C5** — Player mobility (cross-club booking with billing mode;
  clash warnings; `federation.book_at_partners` permission)
- **C6** — Federation UI (`/dashboard/federation`: member clubs list,
  invitations, settings, booking activity)

### Key architectural choices

- Permissions-not-roles gives clubs flexibility to match their committee
  structure without the platform prescribing org charts.
- Groups (not flat lists) because clubs think in terms of "the finance
  team" not individual permission grants.
- Flat federation matches real-world bowling club agreements (no
  hierarchy, no governing body).
- Guardrails contain query fan-out (max 30 tenants in a user's federation
  set via 10×3 limit).
- Soft clash warnings respect user autonomy while catching likely mistakes.

### Rejected alternatives

- Flat permission list per member: simpler but doesn't map to how clubs
  think.
- Replace TENANT_ADMIN entirely now: breaking change across all route
  guards — too risky mid-feature.
- Hierarchical federations: no real-world demand from bowling clubs;
  adds complexity without value.
- Hard-block on cross-club clashes: too paternalistic; tournament
  organisers legitimately book multiple clubs same day.

## Resume signals

- User asks about permissions, roles, or committee access control.
- User asks about federations or cross-club booking.
- TAR wizard or funding features need finer-grained access than
  TENANT_ADMIN.
- `#retire-role-mode` equivalent work in this repo.

## Cross-refs

- `DECISIONS.md` 2026-05-05 — "Federation & Permissions Revamp: full design plan"
- `DECISIONS.md` 2026-05-05 — "Permission groups: club-defined, intersects with federations" (superseded by above)
- `ROADMAP.md` — Next
- `IN_FLIGHT.md` — Just parked
