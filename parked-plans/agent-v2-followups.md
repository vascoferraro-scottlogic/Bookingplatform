# Parked plan: Agent v2 follow-ups (`#agent-self-supersede`, `#triager-proposals`)

**Status as of 2026-05-05**: parked after the agent-v2 propose-not-publish
loop landed end-to-end (DECISIONS 2026-05-05). Two follow-ups deferred
with concrete sketches. Not blockers for the substrate or inbox; both
are agent-side polish that should land before the inbox sees production
traffic.

## Why parked

User pivoted to the inbox UI mid-3c sequence: "the UI is where the
propose-not-publish discipline becomes visible — useful sanity-check
moment". 3c-iv and 3c-v were sequenced after Step 4 in the original plan
but Step 4 was promoted ahead of them so the loop could be exercised
visually. Both follow-ups have full implementation sketches; nothing
exploratory remains.

## What shipped

- Step 3c-i: `MAINTENANCE_TASK_CREATE` committer with smart merge
  ([src/lib/agent/committers/maintenance-task-create.ts](../src/lib/agent/committers/maintenance-task-create.ts)).
- Step 3c-ii: detector emits proposals only, no domain writes
  ([src/lib/agent/agents/detector.ts](../src/lib/agent/agents/detector.ts)).
- Step 3c-iii: topic clustering with token Jaccard
  ([src/lib/agent/clustering.ts](../src/lib/agent/clustering.ts)). See
  `DECISIONS.md` 2026-05-03.
- Step 4: inbox UI + review API
  ([src/app/dashboard/agents/inbox/page.tsx](../src/app/dashboard/agents/inbox/page.tsx),
  [src/app/api/agent/proposals/route.ts](../src/app/api/agent/proposals/route.ts) + `[id]/approve` + `[id]/reject`).
- Dev helper: [scripts/seed-fake-proposals.ts](../scripts/seed-fake-proposals.ts).

See `DECISIONS.md` 2026-05-05 entry for the consolidated landing.

## What's left (refined plan)

### `#agent-self-supersede` (Step 3c-iv)

**Pull in before the inbox sees production traffic** — otherwise admins
see stale duplicates and learn to distrust the queue.

**Why it matters**: detector runs on a schedule. Run N at 09:00 emits
"Rink 3 surface uneven" with 4 voices. Run N+1 at 10:00 sees the same
discussion still happening, possibly with 2 more voices, and emits a
fresh proposal. Without supersede, the inbox stacks duplicates as the
discussion rolls on. The propose-not-publish discipline calls this out
explicitly (plan §A.12 "agents on subsequent runs supersede their own
pending proposals when reality has moved past them").

**Plumbing already in place**:
- `AgentProposalStatus.SUPERSEDED` exists in the enum.
- `clusterMessages()` returns deterministic representativeId for
  matching across runs.
- Committer's `titleTokenOverlap()` (Jaccard, stop-words stripped) is
  the right similarity function — reuse, don't duplicate.

**Sketch**:
1. In `BaseAgent` (or detector specifically), after emitting fresh
   proposals for run N: query `AgentProposal where agentId=self,
   tenantId=tenant, status=PENDING, createdAt < runStart`.
2. For each stale proposal, parse `payload.title`. Run
   `titleTokenOverlap` against the freshly-emitted proposals' titles
   in the same channel.
3. On hit (≥0.4 — same threshold the committer uses, deliberate
   consistency): mark stale `status=SUPERSEDED`, set
   `committedAt=now()`, no committedEntityId. Audit row optional —
   probably not, this is internal housekeeping.
4. On miss (no fresh proposal for that topic): leave PENDING. The
   topic's gone quiet; the proposal is still actionable.

**Edge cases**:
- Stale proposal with no fresh equivalent + topic genuinely abandoned:
  hits the existing `expiresAt` mechanism (or future TTL sweep). Not
  this work's problem.
- Approver clicks the stale proposal between supersede-detection and
  supersede-write: race window is tiny (one DB round-trip); committer
  already enforces PENDING-only at apply-time, so worst case is a
  surprised approver and a no-op.

**Files affected**:
- `src/lib/agent/agents/detector.ts` — call supersede after emit.
- Either inline or extract to `src/lib/agent/supersede.ts` if other
  agents will need the same logic. (Triager will, when migrated —
  point in favour of extracting now.)
- New tests: `src/lib/__tests__/agent/detector-supersede.test.ts`
  (~3-4 cases — supersede on overlap, leave on no-overlap, leave
  cross-tenant, leave non-self).

**Estimate**: half a day.

### `#triager-proposals` (Step 3c-v)

**Less urgent than 3c-iv**: triager output goes to a real human (the
assignee) rather than the inbox queue, so duplicate proposals are less
of a trust-damage issue. But the propose-not-publish discipline isn't
honoured on the second agent until this lands.

**Current state**: TriageAgent
([src/lib/agent/agents/triager.ts](../src/lib/agent/agents/triager.ts))
still writes to `MaintenanceTask` directly: assigns `assigneeId`, sets
`status=ASSIGNED`, creates `TASK_ASSIGNED` notification. Mirrors the
old pattern detector used to follow.

**Sketch**:
1. New committer
   `src/lib/agent/committers/maintenance-task-assign.ts` with
   `MAINTENANCE_TASK_ASSIGN_KIND = "MAINTENANCE_TASK_ASSIGN"`.
   Payload: `{ taskId, assigneeId, reasoning }`.
2. Apply-time guards: task still `SUBMITTED`; assignee still has
   MAINTENANCE role on the tenant. On either failure: REJECTED with
   `reason=task_state_changed` or `reason=assignee_lost_role`. Same
   "membership may have lapsed" pattern as the cross-tenant approval
   guard in the strategy plan §C.
3. Side effects: transition task `SUBMITTED→ASSIGNED`, set
   `assigneeId`, create `TASK_ASSIGNED` notification (reuse existing
   notification code, just move the call site from triager to
   committer).
4. Register in `committers/register-all.ts`.
5. Triager rewrite: call `emitTenantProposal({kind:
   MAINTENANCE_TASK_ASSIGN_KIND, payload, ...})` instead of direct
   write. Remove the notification call.
6. Tests: `src/lib/__tests__/agent/maintenance-task-assign-committer.test.ts`
   (~6-8 cases — happy path, task already assigned, assignee lost
   role, cross-tenant assignee, idempotent re-apply).
7. Triager test suite gets the same shape change as detector did in
   3c-ii: assert proposals emitted, not tasks mutated.

**Inbox UX consideration**: a `MAINTENANCE_TASK_ASSIGN` proposal looks
different from a `MAINTENANCE_TASK_CREATE` one — it references an
existing task. The current inbox card renders payload generically. May
want a per-kind card variant once both kinds are flowing. Not blocking;
the generic card will work, just less informative.

**Files affected**:
- `src/lib/agent/committers/maintenance-task-assign.ts` (new)
- `src/lib/agent/committers/register-all.ts` (add import)
- `src/lib/agent/agents/triager.ts` (rewrite)
- `src/lib/__tests__/agent/triager.test.ts` (rewrite assertions)
- `src/lib/__tests__/agent/maintenance-task-assign-committer.test.ts` (new)
- Optional: `src/app/dashboard/agents/inbox/page.tsx` per-kind card variant

**Estimate**: 1 day if no inbox card work; +half-day with card variant.

## Resume signals

- Inbox is about to be exposed to real traffic (e.g. enabling the
  detector against production messaging on any tenant) → 3c-iv first,
  not optional.
- Triager is scheduled to run against any tenant's messaging → 3c-v
  (otherwise the propose-not-publish discipline only holds for half
  the agent fleet).
- Adding any new agent that mutates existing rows (rather than creates
  new ones) → look at how 3c-v handles state-transition committers as
  a template.

## Cross-refs

- `DECISIONS.md` — 2026-05-05 "Agent v2: propose-not-publish loop
  closed end-to-end".
- `DECISIONS.md` — 2026-05-03 "Agent framework v2: AgentProposal
  substrate + scopes + costs" (Step 1 of 11).
- `DECISIONS.md` — 2026-05-03 "Detector clustering: token Jaccard,
  0.35 / 60min defaults" (Step 3c-iii).
- `DECISIONS.md` — 2026-05-03 "Member-message-derived tasks:
  anonymised, MAINTENANCE-only by default" (privacy policy these
  follow-ups must continue to honour).
- `ROADMAP.md` Later — `#agent-self-supersede`, `#triager-proposals`.
- Strategy plan `/memories/session/plan.md` §A.12 (supersede mechanism)
  and §H (triager scope).
