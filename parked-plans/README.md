# Parked plans

One file per parked plan, named `<tag>.md` matching the `#tag` used in
`IN_FLIGHT.md` / `ROADMAP.md` / `DECISIONS.md`.

**When to add a file here**: a session produced a refined plan, partially
shipped some of it, and the remainder is parked. The *plan* itself is the
artefact worth preserving — without it, the next session has to re-derive
how to do the work.

**File template**:

```markdown
# Parked plan: <descriptive title> (`#<tag>`)

**Status as of YYYY-MM-DD**: parked after <session>. <One sentence on what
shipped, what's left, and any assumptions that may need re-checking.>

## Why parked

(Brief — link to `/memories/repo/open-questions.md` entry for the full
rationale if there is one.)

## What shipped

- Concrete bullet of code/behaviour change. Cross-ref `DECISIONS.md` entry.

## What's left (refined plan)

(The actual plan — steps, rationale, rejected alternatives, files
affected. This is the bit that vanishes if not promoted from session
memory.)

## Resume signals

- What event/observation should pull this back into Active.

## Cross-refs

- `DECISIONS.md` — <date entry titles>
- `/memories/repo/open-questions.md` — <section name>
- `ROADMAP.md` — <Now/Next/Later>
```

**Lifecycle**:
1. Created when a substantive plan is parked mid-flight.
2. Updated if the plan is revisited and re-parked (refresh the
   "Status as of" header; preserve prior content under a `## History`
   section if it's worth keeping).
3. When the work resumes and ships, the relevant outcome lands in
   `DECISIONS.md` and this file is deleted (or kept with a final
   "**Status**: shipped, see DECISIONS YYYY-MM-DD" header if the
   refined plan doc has standalone reference value).
