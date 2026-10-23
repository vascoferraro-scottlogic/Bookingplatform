# 08 — Implementation Decisions (reference build only)

> **This file exists only on the `reference/fixed` branch.** It answers the
> requirement ambiguities that the trainer guide (`06-trainer-guide.md`, §6) asks
> graduates to find. Do not merge it to `main`. It would spoil the analysis
> exercise.

The requirements pack leaves several questions open on purpose. The reference
build has to behave somehow, so each open question was decided as below. The
automated tests on this branch assert these decisions, and the fixes implement
them.

**Basis** says where each decision comes from:

- **Text:** the requirement wording already settles it. Only the code was wrong.
- **Judgement:** the requirement is silent or ambiguous, so a choice was made.
  A real project would need the product owner to confirm it.

Decided 23 Oct 2026.

---

## D-01 — When is payment requested?

- **Requirements:** FR-PAY-001, FR-PAY-005, FR-BOOK-003
- **Question:** Is the member asked to pay when the booking is RESERVED, or when it is CONFIRMED?
- **Decision:**
  - Checkout is created when a booking that carries a fee moves to **CONFIRMED**.
  - The fee is the club's per-booking fee (FR-PAY-005), charged per slot.
  - The Pay action stays available to the member until the payment is PAID.
- **Basis:** Text. FR-PAY-001 says to start checkout "when a booking that carries a fee is confirmed".

## D-02 — Does an APPROVED booking block the slot?

- **Requirements:** FR-BOOK-009, FR-BOOK-003, NFR-08
- **Question:** Can another member book a rink and time that already has an APPROVED (but not yet reserved) booking?
- **Decision:**
  - Only **RESERVED** and **CONFIRMED** bookings block a slot. REQUESTED and APPROVED do not.
  - Approving, reserving or confirming a booking re-checks for a clash. The action is refused (409) if the slot is now held.
- **Basis:** Text. FR-BOOK-009 says to reject a slot "already held by a confirmed or reserved booking".

## D-03 — Waiting list: is the first waiter assigned automatically?

- **Requirements:** FR-BOOK-011
- **Question:** When a slot frees up, is a booking created for the first waiter without asking them? Which cancellations trigger it?
- **Decision:**
  - Only cancelling a **CONFIRMED** booking triggers the waiting list.
  - The first waiter, by join time, gets a new booking for that slot in status **REQUESTED** and is notified. Their consent is the normal booking flow from there.
  - The other waiters stay queued in order. A member can join a waiting list only once.
- **Basis:** Text plus judgement. "Auto-assign the first waiter … leaving remaining waiters" is text. Creating the booking as REQUESTED, rather than CONFIRMED, is judgement.

## D-04 — The 48-hour cancellation boundary

- **Requirements:** FR-BOOK-012, FR-BOOK-013
- **Question:** What happens at exactly 48 hours? What is the window measured from?
- **Decision:**
  - The window is measured from the **slot start time**, meaning the booking date plus its time slot in the club's timezone (see D-05).
  - A member may cancel their own RESERVED or CONFIRMED booking only when the slot start is **more than 48 hours** away.
  - At exactly 48 hours, or less, only a tenant admin may cancel.
- **Basis:** Text. FR-BOOK-012 says "more than 48 hours", so exactly 48 hours falls inside the admin-only window.

## D-05 — Timezone of "the date"

- **Requirements:** FR-BOOK-004, FR-BOOK-005, FR-BOOK-006, FR-BOOK-012/013/014
- **Question:** Booking dates, season dates and the cancellation window are evaluated in whose timezone?
- **Decision:**
  - They are evaluated in the **club's timezone**.
  - Where a club has no timezone set, **Europe/London** is used.
  - The server's own timezone never affects the result.
- **Basis:** Judgement. The requirements never state a timezone.

## D-06 — Refund qualifying conditions

- **Requirements:** FR-PAY-002, FR-BOOK-012, FR-BOOK-013
- **Question:** Which cancellations of a paid booking are refunded automatically?
- **Decision:**
  - A PAID booking is refunded automatically when:
    - the member cancels it outside the 48-hour window (D-04); or
    - a tenant admin cancels it at any time.
  - If the refund fails:
    - the booking is still CANCELLED;
    - the payment is marked **REFUND_FAILED** for an admin to follow up;
    - the response carries a warning.
  - REFUNDED is only ever set by a successful refund, never by a member.
- **Basis:** Judgement. "Qualifying conditions" is undefined.

## D-07 — Who counts as a "partner" for event sharing?

- **Requirements:** FR-EVT-004, FR-FED-001
- **Question:** Inbound event sharing shows "partner clubs'" events. Which clubs are partners?
- **Decision:**
  - A partner is a club that shares an **ACTIVE federation membership** with the viewing club.
  - Both clubs must have opted in: outbound sharing on the publishing club, and inbound display on the viewing club.
- **Basis:** Judgement. "Partner" is not defined.

## D-08 — What can a suspended tenant still do?

- **Requirements:** FR-SET-002, FR-BIL-008
- **Question:** "Restricted" access for a SUSPENDED (or CHURNED) tenant is never defined.
- **Decision:**
  - Members and admins of the tenant can't log in to it, select it as their active club, or switch to it.
  - Only a platform admin can still view it, for example to reactivate it.
  - Memberships of the user's other, active clubs are unaffected.
- **Basis:** Judgement. "Restricted" is undefined.

## D-09 — Maintenance categories

- **Requirements:** FR-MNT-002
- **Question:** The requirement lists seven categories, but the product has eight (it includes PREVENTIVE).
- **Decision:**
  - Keep the product's eight categories.
  - The UI shows translated labels, not raw codes.
  - The requirement wording is not changed.
- **Basis:** Judgement.
