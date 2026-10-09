# 05 — Traceability Matrix

*Proves the requirements hang together: every FR has a parent HLBR, and every
HLBR serves the Vision. Testers use it to find **orphans** (work with no parent)
and **gaps** (requirements with no coverage below them).*

---

## 1. Vision → HLBR

| Vision theme | HLBRs that serve it |
|--------------|---------------------|
| VIS-1 Multi-tenant white-label | BR-01, BR-05, BR-16, BR-19 |
| VIS-2 Tailored capability bundles | BR-02 |
| VIS-3 Self-serve onboarding | BR-04 |
| VIS-4 Platform-runs-the-shop | BR-03, BR-05, BR-06, BR-15, BR-20 |
| VIS-5 Facility operations | BR-08, BR-09, BR-10 |
| VIS-6 Charity & funding | BR-14 |
| VIS-7 Member engagement | BR-11, BR-12, BR-19 |
| VIS-8 AI-powered guidance | BR-10, BR-13, BR-15, BR-18 |
| VIS-9 Trust & accountability | BR-06, BR-07 |
| VIS-10 Reach & inclusivity | BR-17 |

Every vision theme has at least one HLBR → **no orphan themes**.

---

## 2. HLBR → Functional Requirements

| HLBR | Priority | FR areas (count) | Delivery status of children |
|------|----------|------------------|------------------------------|
| BR-01 Isolation | Must | FR-TEN (5), FR-SEC-006, FR-MSG-004, FR-AUD | Implemented |
| BR-02 Capability bundles | Must | FR-FLAG (4), FR-TEN-005, FR-CHA-001 | Implemented |
| BR-03 Platform-operated | Must | FR-SEC, FR-FLAG-003, FR-ONB, FR-SET (3) | Implemented (FR-SET Planned) |
| BR-04 Self-serve onboarding | Must | FR-ONB (8), FR-SITE-001 | Implemented (gate Planned) |
| BR-05 Subscription revenue | Should | FR-BIL (8) | **WIP + Planned only** ⚠ |
| BR-06 Access control | Must | FR-SEC (9), FR-AUTH, FR-AUD-003/004 | Implemented (FR-AUTH-003 Planned) |
| BR-07 Accountability | Must | FR-AUD (4), FR-RPT-001 | Implemented (export Planned) |
| BR-08 Bookings | Must | FR-BOOK (21) | Implemented (020/021 Planned) |
| BR-09 Payments | Must | FR-PAY (5) | Implemented (real provider Planned) |
| BR-10 Maintenance | Should | FR-MNT (3), FR-AGT-001/002 | Implemented |
| BR-11 Public/events/content | Should | FR-CMS (2), FR-EVT (6), FR-SITE-001 | Implemented (midge/gate Planned) |
| BR-12 Engagement | Should | FR-STR (7), FR-MSG (4), FR-NTF (2), FR-PWA | Implemented (FR-NTF-002 Planned) |
| BR-13 AI operations | Should | FR-AGT (10), FR-SITE (5), FR-BOOK-014/015/016 | Implemented core; v2 + site-health Planned |
| BR-14 Charity reporting | Must* | FR-CHA (7) | Implemented (FR-CHA-007 Planned) |
| BR-15 Analytics | Could | FR-ANL (6), FR-SITE, FR-RPT (2) | Implemented core; insights WIP/Planned |
| BR-16 Federations | Could | FR-FED (5), FR-BOOK-017/018 | Implemented (billing/guardrails Planned) |
| BR-17 Internationalisation | Could | FR-I18N (4) | **WIP + Planned** |
| BR-18 Help | Could | FR-HLP (3) | Implemented |
| BR-19 Advertising | Could | FR-ADV (5) | **Planned** |
| BR-20 Operability | Should | NFR-07, NFR-13, NFR-15, NFR-16 | Partly landed; mostly **Planned** |

`*` BR-14 is *Must* for the charity vertical specifically.

Every HLBR decomposes into at least one FR/NFR → **no orphan HLBRs**.

---

## 3. Delivery-risk read-out (what the matrix exposes)

> This is the payoff of tracing. The structure makes two risks jump out:

1. **BR-05 (Subscription revenue) is a *Should* business requirement with
   *no Implemented functional coverage*** — all of FR-BIL is WIP or Planned.
   The platform's own revenue mechanism is not yet built. That is a commercial
   risk worth stating plainly in a readiness report.
2. **BR-17 (Internationalisation) is served only by WIP/Planned FRs.** The
   capability exists as infrastructure but is not yet complete end-to-end.

Neither is a defect — both are *honest* status. But an analyst who can read a
traceability matrix and surface "your revenue path has no shipped coverage yet"
is already adding value.

---

## 4. Status distribution (where the work really stands)

Read the status column of section 2 across the whole product and a pattern
emerges that a feature list alone hides:

- **Fully shipped backbone:** tenancy, access control, onboarding, bookings,
  payments, maintenance, events/CMS, streaming, messaging, charity, audit —
  BR-01–BR-04, BR-06–BR-14 have an Implemented core.
- **Designed but not yet earning value:** BR-05 (billing), BR-19 (advertising)
  and BR-20 (operability) are mostly or wholly Planned; BR-15 (insights) and
  BR-17 (i18n) are WIP.
- **Partial completions lurking inside shipped areas:** FR-AUTH-003 (reset),
  FR-EVT-006 (midge), FR-CHA-007 (uploads), FR-BOOK-019/020/021 (multi-slot +
  facility generalisation), FR-FED-004/005 (billing modes + guardrails) are
  Planned items sitting next to Implemented siblings. These are the easiest
  gaps to miss, because the *area* looks "done".

Mapping priority against status is the analyst's headline deliverable: a
*Should*-priority revenue requirement (BR-05) with no Implemented coverage is a
more urgent conversation than a *Could*-priority one (BR-19) in the same state.

---

## 5. How to use this matrix

1. **Read down a column** (Vision → HLBR → FR) to understand *why* a feature
   exists before you reason about *what* it does. Analysis that doesn't know the
   business intent tends to critique the implementation, not the requirement.
2. **Read up a column** from any FR to check it earns its place. If you can't
   trace an FR to an HLBR to the Vision, you've found an orphan — ask why it's
   being built.
3. **Scan priority against status** for high-priority requirements served only
   by *WIP/Planned* children — those are your early delivery-risk flags.
