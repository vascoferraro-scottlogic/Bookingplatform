---
title: Frequently asked questions
category: faq
audience: tenant_admin
tags: [faq, troubleshooting]
order: 200
excerpt: Quick answers to the questions club admins ask most often.
updated: 2026-05-02
---

## Why can't a member book a slot that looks free?

Most often: a booking is in `REQUESTED` or `APPROVED` state and is reserving the slot pending payment. Refresh the bookings page and look for an in-flight booking on the same rink + time.

## A member's payment failed — what next?

The booking returns to `APPROVED` automatically. You can ask the member to retry from their bookings list, or refund and rebook from the admin panel.

## How do I change the season start/end?

**Tenant settings → Season**. Bookings outside the configured window are blocked at the API level.

## Can I delete a published event?

Yes, but consider **Unpublish** first — it preserves the event for audit purposes and can be republished later. Delete only when the event was created in error.

## Where do I see who did what?

The **Audit Log** tab shows every significant action across the club. Filter by domain (`booking`, `user`, `content`, etc.) or search for a specific entity id.
