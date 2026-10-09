# 06 — Requirements-Analysis Guide (for graduate testers)

*A facilitator + self-study guide for using this pack to learn **requirements
analysis**. It teaches how to read, question and risk-assess requirements. It
**does not** teach test-case design — deriving tests from these requirements is
a separate, later exercise.*

---

## 1. What this exercise is (and isn't)

| This exercise **is** | This exercise is **not** |
|----------------------|--------------------------|
| Reading requirements critically | Writing test cases or scripts |
| Finding ambiguity, gaps, contradictions | Executing the application |
| Tracing requirements up and down | Logging defects against the product |
| Judging priority vs delivery status | Measuring code coverage |
| Naming the *risk* behind a requirement | Designing the *tests* for that risk |

You stop at **"here is the requirement, here is what's unclear about it, and
here is what could go wrong if we get it wrong."** Turning that into tests comes
afterwards, once you can read a requirement well.

---

## 2. What makes a requirement *good*

Analysts judge each requirement against a small set of quality attributes. Learn
these and you have a checklist for everything in this pack.

| Attribute | The question to ask | Smell to look for |
|-----------|---------------------|-------------------|
| **Unambiguous** | Could two reasonable people read this two ways? | "fast", "easy", "appropriate", "up to", "within" |
| **Complete** | Is anything the reader must know left unsaid? | missing error paths, missing actor, missing boundary |
| **Consistent** | Does it contradict another requirement? | two requirements that can't both be true |
| **Verifiable** | Could you *in principle* tell whether it's met? | no stated criterion, immeasurable adjective |
| **Traceable** | Does it link up to a business need and down to detail? | orphan with no parent HLBR |
| **Prioritised** | Do we know how much it matters? | everything marked "Must" |
| **Feasible / bounded** | Is it realistic and scoped? | open-ended "any", "all", "always" |
| **Necessary** | Does the product actually need it? | gold-plating with no source |

> A requirement that is *verifiable* is not the same as a *test*. "The system
> shall reject a booking outside the season window" is verifiable (you can tell
> whether it holds) without anyone yet writing *how* to check it.

---

## 3. Core analysis techniques, with worked examples

Each technique below is illustrated with a **real requirement from this pack**.
Work through them with the pack open.

### 3.1 Ambiguity hunting — read the quantifiers

> **FR-BOOK-012 / FR-BOOK-013 — the 48-hour window.**
> "more than 48 hours before" (self-service) vs "within 48 hours" (admin only).

Ask: what happens at **exactly** 48 hours? "More than 48 hours" excludes the
instant itself, so 48:00:00 falls to admin-only — but a reader skimming "up to
48 hours" elsewhere might assume the opposite. The boundary instant is the
ambiguity. *Finding:* the two requirements are individually readable but the
precise changeover instant should be stated once, explicitly.

### 3.2 Hidden-assumption hunting — what must be true but isn't said

> **FR-BOOK-004 — "reject a booking outside the green's season window."**

Unsaid: in **whose timezone** is "the date" evaluated? Against the server clock
or the club's locale? VISION mentions globally-distributed organisations with
local config, so timezone is a live assumption. *Finding:* the requirement omits
the reference timezone — a real source of off-by-one-day behaviour.

### 3.3 Completeness — follow the unhappy paths

> **FR-PAY-002 — "automatically refund a paid booking when it is cancelled
> under qualifying conditions."**

"Qualifying conditions" is a hole. Which cancellations qualify — only those
outside the 48h window (FR-BOOK-012)? What about an *admin* cancellation inside
the window (FR-BOOK-013) — refund or not? *Finding:* the refund rule is
incomplete and must be reconciled with the cancellation policy.

### 3.4 Consistency — set requirements against each other

> **FR-AGT-010** says high-impact agent outputs **shall** be *proposed* for
> human approval. **FR-AGT-001** says the triage agent **auto-creates** a
> maintenance task.

These two pull in opposite directions. The pack even flags that migrating the
triager to proposals is Planned. *Finding:* a current inconsistency between a
general rule and a specific behaviour — exactly the kind of contradiction
analysis exists to surface.

### 3.5 State-model reading — is the lifecycle total?

> **FR-BOOK-003** — `requested → approved → reserved → confirmed →
> cancelled/refunded`.

Ask of every state machine: are all *legal* transitions listed, and are illegal
ones implicitly forbidden? Can you cancel a `requested` booking? Can a
`cancelled` booking be reinstated? *Finding:* the happy path is specified; the
illegal transitions and re-entry rules are not.

### 3.6 Boundary & data-domain reading (of the wording, not of a test)

> **FR-BOOK-015** — flag bookings "**at or above 40%**" no-show probability.

The threshold is explicit and inclusive — good. Now read neighbours: does any
other threshold in the pack say "over" vs "at least"? Inconsistent inclusivity
across thresholds is a classic latent defect. *You are analysing the wording's
precision, not yet designing the 39.9%/40.0% test.*

### 3.7 Traceability — hunt orphans and gaps

Use [05-traceability-matrix.md](05-traceability-matrix.md):
- **Orphan:** an FR with no parent HLBR, or an HLBR serving no vision theme.
- **Gap:** a high-priority HLBR whose only children are *Planned* (e.g. BR-05
  revenue → all FR-BIL is WIP/Planned).

*Finding shape:* "BR-05 is a Should-priority business requirement with no
shipped functional coverage — flag before a go/no-go."

### 3.8 Priority vs status sanity

Scan for *Must* business requirements leaning on *WIP/Planned* functionality,
and for a wall of "Must" that can't all truly be must. Mismatches are planning
risks worth naming.

### 3.9 Testability-of-wording (not test design)

For each requirement ask only: *"If someone claimed this was done, could I in
principle judge the claim?"* If the answer needs a number that isn't there (see
the NFR *(TBD)* targets), the requirement isn't yet testable — a finding in
itself. You are assessing whether the requirement *admits* verification, not
writing the verification.

---

## 4. From requirement to risk (where the exercise ends)

The last analysis step is to name the **risk**: what is the impact if this
requirement is wrong, missing, or misread? Keep it to impact + likelihood, and
stop there.

| Requirement | Risk if wrong (impact) | Why it's high/low |
|-------------|------------------------|-------------------|
| FR-TEN-003 (no cross-tenant write) | One club writes another club's data | Catastrophic: trust + data-protection breach |
| FR-SEC-003 (platform plane is orthogonal) | Platform admin silently gains tenant powers | High: privilege leak, hard to notice |
| FR-PAY-004 (webhook idempotency) | Replayed callback double-charges a member | High: money + reputation |
| FR-AUD-003 (impersonation attribution) | An action can't be pinned to the real actor | High: accountability + disputes |
| FR-SITE-001 (content go-live gate) | Club launches an empty public site | Medium: reputational, recoverable |
| FR-EVT-005 (weather widget) | Forecast wrong or missing | Low: cosmetic |

Notice the risk ranking tracks the **isolation / access / money / accountability**
requirements — the same ones marked *Must*. That alignment is the point: priority,
risk and business intent should agree, and where they *don't*, you've found
something to raise.

> **Explicitly out of scope here:** turning "FR-PAY-004 risk: replay
> double-charges" into "test: POST the same webhook event id twice and assert a
> single charge." That is test design — a later skill. Here you only need to
> have *named* the risk.

---

## 5. Suggested session plan (half-day)

1. **Orientation (20 min).** Read [README](README.md),
   [01-vision-and-scope.md](01-vision-and-scope.md), and the HLBR list.
2. **Technique drill (60 min).** In pairs, each pair takes one FR area and runs
   §3.1–§3.6 against it. Capture findings as a flat list: *ID — attribute
   failed — one-line finding.*
3. **Traceability hunt (30 min).** Using the matrix, each pair finds one orphan
   or one gap and states the delivery risk.
4. **Risk naming (30 min).** Each pair ranks their area's requirements by risk
   (impact only) and picks the top three.
5. **Readout (40 min).** Pairs present; facilitator maps findings onto the
   quality-attribute checklist (§2) to show the *categories* of problem.

---

## 6. Facilitator notes (planted findings)

The pack contains genuine, reverse-engineered ambiguities and gaps. A few worth
steering graduates toward if they stall — **don't hand these out up front**:

- **48-hour boundary instant** (FR-BOOK-012/013): the exact changeover is
  under-specified.
- **"Qualifying conditions" for refunds** (FR-PAY-002): incomplete; must be
  reconciled with FR-BOOK-012/013.
- **Agent proposal vs auto-create contradiction** (FR-AGT-010 vs FR-AGT-001).
- **Suspended-tenant capabilities** (FR-SET-002 + FR-BIL-008): "restricted" is
  never defined — what exactly can a suspended tenant still do?
- **Waiting-list auto-assign without consent** (FR-BOOK-011): does the first
  waiter get a choice, or is a booking created for them?
- **Timezone of "the date"** (FR-BOOK-004/005): never stated.
- **NFR *(TBD)* targets** (latency, uptime, a11y level, retention): several
  quality requirements carry no number yet.
- **Revenue delivery gap** (BR-05 → FR-BIL all WIP/Planned).

For each, the teaching point is not "the product is broken" — most describe
*honest* current status — but "a requirement that reads this way **will** be
built or interpreted inconsistently unless the ambiguity is resolved first."

---

## 7. What good output looks like

A graduate's deliverable from this pack is a **findings log**, not a test plan.
Each row:

```
FR-ID | quality attribute at fault | the finding (one sentence) | risk if unresolved
```

Example rows:

```
FR-PAY-002 | Complete  | "Qualifying conditions" for auto-refund are undefined;
                          conflict with admin cancel inside 48h (FR-BOOK-013).
                          | Risk: wrong refunds either way — money + disputes.
FR-SET-002 | Unambiguous | "Restricted" access for a suspended tenant is never
                           defined (also FR-BIL-008).
                           | Risk: inconsistent enforcement; data access while unpaid.
BR-05      | Traceable   | Should-priority revenue requirement has only WIP/Planned
                           children (all FR-BIL).
                           | Risk: platform cannot bill; surface before go/no-go.
```

That log — precise, traceable, risk-aware, and free of invented test steps — is
the skill this pack is built to teach.
