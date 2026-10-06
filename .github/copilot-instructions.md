# Copilot instructions — BookingPlatform

Cross-session state lives in committed files plus repo memory. Read the
committed files at the start of any non-trivial task so parallel chat
sessions don't duplicate work or re-derive plans that already exist.

## State files (read these first)

- **`ROADMAP.md`** — where this is headed (Now / Next / Later / Deferred).
- **`IN_FLIGHT.md`** — what's open right now (Active / Just parked /
  Recently landed).
- **`DECISIONS.md`** — why we chose what we chose (append-only).
- **`VISION.md`** — the longer-horizon north star this roadmap serves.
- **`parked-plans/<tag>.md`** — refined plans frozen mid-flight, keyed
  by `#tag`. Read the relevant one if the user's task matches a tag.

## Repo memory (read on demand)

These live in `/memories/repo/` and are loaded into context automatically,
but consult them explicitly when relevant:

- **`open-questions.md`** — what's parked and why. Check before starting
  work on a dormant tag.
- **`gotchas.md`** — build quirks, test fragility, dev workarounds.
  Check before debugging a flaky test or an unexpected build failure.
- **`architecture.md`** — stack snapshot, what's built, lifecycle gaps,
  tech debt. Check before designing a new feature that touches
  multi-tenant resolution, roles, or feature flags.
- **`booking-workflow.md`** — booking model + API + UI wiring.
  Check before touching booking routes or the availability grid.

## Behaviour at task start

1. **Check for tag overlap**. If the user's request matches an Active
   entry in `IN_FLIGHT.md`, surface it: "there's already a thread on
   `#<tag>` — resume that session, or branch off deliberately?"
2. **Check parked entries**. If it matches a Parked or Deferred entry,
   surface the entry (and `parked-plans/<tag>.md` if one exists) before
   investigating from scratch.
3. **Suggest a session name**. For new investigations on a fresh tag,
   suggest renaming the chat session to `bp: #<tag>` so it lines up
   with the ledger. (User renames sessions manually via the chat history
   UI; don't try to do it programmatically.)

## Behaviour when wrapping a substantive session

1. **Update `IN_FLIGHT.md`**:
   - Move Active → Just parked if work is paused mid-flight.
   - Move Active → Recently landed if work shipped (trim oldest
     so Recently landed stays ≤5 entries).
2. **Promote refined plans on park**. If a substantive plan was
   developed this session and only partially shipped, ask the user
   whether to promote the remainder to `parked-plans/<tag>.md` with a
   `Status as of <date>` header. Don't auto-promote pure feasibility
   discussions — only plans with concrete steps worth preserving.
3. **Update `ROADMAP.md`** if a Now/Next item shifted, or if a parked
   item should be promoted from Later → Next.
4. **Append to `DECISIONS.md`** per the standing decision-capture
   instruction at
   `~/Library/Application Support/Code/User/prompts/decision-capture.instructions.md`.

## Conventions

- One `#tag` per topic, threaded through all state files.
- Tags are repo-local — don't try to unify across repos.
- Sizing key on `ROADMAP.md`: S = a session, M = a few sessions, L = a
  focused sprint.
- The repo memory log `/memories/repo/decisions-log.md` was retired
  2026-05-05; `DECISIONS.md` is the single canonical log.

## i18n convention

Every new `.tsx` component with user-visible text MUST use
`useTranslations` (client) or `getTranslations` (server) from
`next-intl`. Structural wrappers (layouts, providers) that render no
visible text are exempt.

- Keys go in the appropriate namespace JSON under
  `content/messages/ui/en/`. Use **nested objects**, not flat
  dot-notation keys (`{ "locality": { "label": "..." } }` not
  `{ "locality.label": "..." }`). next-intl rejects dots in keys.
- Copy the key to the matching `cy/` file with a `[cy] ` prefix
  (machine placeholder — professional translation comes later).
- 14 namespaces exist: `common`, `auth`, `bookings`, `maintenance`,
  `events`, `messaging`, `settings`, `streaming`, `help`, `billing`,
  `agents`, `admin`, `onboarding`, `charity`. Create a new namespace
  only if none of these fit.
- `src/i18n/request.ts` must import any new namespace.
- Run `npm run check:i18n` to verify coverage before committing.
