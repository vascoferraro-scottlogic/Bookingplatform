# Requirements Pack — BookingPlatform

A traditional ("old-school") requirements pack, **reverse-engineered** from the
product as currently built **and as designed on the backlog**. It is written as
a *teaching artefact* for newly-hired graduate testers to practise two core
skills:

1. **Requirements analysis** — reading a requirement critically, spotting
   ambiguity, gaps, contradictions, hidden assumptions, and untestable wording.
2. **Risk & traceability thinking** — identifying what could go wrong behind a
   requirement and checking it traces cleanly from vision to business goal to
   detailed statement.

> **Scope of this pack.** It *defines requirements* — vision, business
> requirements, functional and non-functional requirements, and their
> traceability. It deliberately **stops short of test cases**: deriving tests
> from these requirements is the graduate's downstream exercise, not part of
> the pack.

> This pack is **documentation about the product**, not a change to the product.
> It deliberately mirrors how a real (imperfect) requirements set reads, so the
> ambiguities and gaps you find are features of the exercise, not mistakes to
> report. It covers **both shipped and not-yet-built** capabilities — a planned
> requirement is still a requirement to analyse.

---

## The requirements hierarchy

This pack follows the classic three-tier flow-down. Each tier answers a
different question and traces up to the tier above it.

```
VISION            Why does the product exist? (the north star)
   │   "A modular, multi-tenant SaaS platform for member organisations…"
   ▼
HLBR              What must the business achieve? (outcome-level)
   │   BR-01 … BR-18  — "The platform must let a club self-onboard…"
   ▼
FUNCTIONAL REQS   What must the system do? (testable "shall" statements)
       FR-SEC-001 … — "The system shall reject any request whose resolved
                       tenant differs from the resource's owning tenant."
```

Supporting tiers:

- **Non-functional requirements (NFR)** — quality attributes (security,
  performance, availability, data protection, usability, i18n).
- **Traceability matrix** — proves every FR has a parent HLBR and every HLBR
  serves the Vision. Testers use it to find *orphans* (untraceable work) and
  *gaps* (business requirements with no functional coverage).

---

## What's in the pack

| File | Tier | Purpose |
|------|------|---------|
| [01-vision-and-scope.md](01-vision-and-scope.md) | Vision | The product's reason to exist, in/out of scope, stakeholders, constraints. |
| [02-business-requirements-HLBR.md](02-business-requirements-HLBR.md) | HLBR | High-Level Business Requirements (`BR-nn`), outcome-level, traced to the vision. |
| [03-functional-requirements.md](03-functional-requirements.md) | FR | Detailed "the system shall…" statements (`FR-AREA-nnn`), traced to HLBRs. |
| [04-nonfunctional-requirements.md](04-nonfunctional-requirements.md) | NFR | Quality attributes (`NFR-nn`). |
| [05-traceability-matrix.md](05-traceability-matrix.md) | — | Vision ↔ HLBR ↔ FR ↔ verification. |
| [06-trainer-guide.md](06-trainer-guide.md) | — | How to run the pack as a requirements-analysis exercise for graduates, with worked examples and facilitator notes. |
| [07-glossary.md](07-glossary.md) | — | Domain vocabulary (tenant, green, rink, impersonation, TAR, R&P…). |

---

## How to read a requirement in this pack

Every functional requirement is written as a numbered record:

> **FR-BOOK-012 — Cancellation window**
> *Priority:* Must · *Status:* Implemented · *Source:* BR-08
> The system **shall** allow a member to cancel their own confirmed booking
> without admin involvement only when the cancellation is made **more than 48
> hours before** the booked play time. Within 48 hours, only a tenant admin
> may cancel.

Read each field deliberately:

- **ID** — stable handle for tracing work back to its requirement.
- **Priority** — MoSCoW (*Must / Should / Could / Won't*). Signals how much it
  matters to the business.
- **Status** — *Implemented*, *WIP*, or *Planned*. A *Planned* requirement is
  still fully analysable — you just can't observe its behaviour yet.
- **Source** — the parent HLBR. If you can't trace it up, that's a finding.
- **Shall statement** — the heart of the requirement. Hunt here for ambiguity
  ("more than 48 hours" — is exactly 48h inside or outside? the phrase *more
  than* answers it; compare with wording elsewhere that is *not* so careful).

---

## Status legend

| Status | Meaning |
|--------|---------|
| **Implemented** | Shipped to `main`; behaviour is observable today. |
| **WIP** | Partially built; behaviour may be incomplete or behind a flag. |
| **Planned** | On the roadmap or in a `parked-plans/` design; intent only, not yet built. |

Priorities use MoSCoW: **Must**, **Should**, **Could**, **Won't (this release)**.

---

## Provenance

These requirements were reconstructed from the live product artefacts:
[VISION.md](../../VISION.md), [FEATURES.md](../../FEATURES.md),
[ROADMAP.md](../../ROADMAP.md), [DECISIONS.md](../../DECISIONS.md), the
`parked-plans/` design files, and the implementation under `src/`. Both
**shipped** behaviour and **backlog/roadmap** intent are included; the *Status*
field on each requirement tells you which. For shipped features, where the code
and the prose disagree the **code is the ground truth**; for planned features,
the design intent on the backlog is the source.
