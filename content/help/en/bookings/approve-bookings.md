---
title: Approving and rejecting booking requests
category: bookings
audience: tenant_admin
tags: [bookings, approval, workflow]
order: 20
excerpt: How to handle the booking queue — from member request through to confirmed and paid.
updated: 2026-05-02
---

Member bookings move through a small workflow:

```
REQUESTED → APPROVED → RESERVED → CONFIRMED
                    ↘ CANCELLED / REFUNDED
```

## Approving a request

1. Go to **Bookings** in the sidebar.
2. New requests appear at the top with status **REQUESTED**.
3. Click **Approve** to move the booking to **APPROVED**. The member is notified.
4. If payment is required, the next step is **Reserved** once a checkout has been created. Confirmation is automatic on successful payment.

## Rejecting a request

Click **Reject**. Provide a short reason — it's included in the notification sent to the member and recorded in the audit log.

## Refunding a confirmed booking

Confirmed bookings can be refunded from the booking detail panel. The refund triggers the configured payment engine and records a `payment.refund.*` audit entry.

:::platform-admin
When [acting on behalf of a club](/dashboard/help/users-roles/impersonation), prefer to leave routine approvals to the club's own admins. Use approval/refund only when the club has explicitly asked you to. Every action shows up in their audit log attributed to you.
:::

## Common pitfalls

- **Approving a slot that conflicts with another booking** — the API blocks this, but a refresh on the bookings page is sometimes needed to see a freshly created conflict.
- **Refunding outside the season window** — the payment engine still processes the refund, but the slot can't be re-booked until the season opens.
