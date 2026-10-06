---
title: Creating and publishing events
category: events
audience: tenant_admin
tags: [events, publishing, sharing]
order: 80
excerpt: Draft, publish and (optionally) share events with other clubs on the platform.
updated: 2026-05-02
---

Events have a simple two-state lifecycle: **Draft → Published**.

## Creating an event

1. Open **Events** and click **New event**.
2. Fill in title, date/time, category (social, competition, league, open day, tournament), and any tournament-specific fields (format, player count).
3. Save as a draft, then **Publish** when ready.

## Visibility

- **Members only** — visible to signed-in members of your club.
- **Public** — visible to anyone visiting your club's landing page, signed in or not.

## Cross-tenant sharing

Two feature flags control event sharing:

- `eventsShareExternal` (outbound) — your published events appear in other clubs' lists.
- `eventsShowExternal` (inbound) — events from other clubs appear in your dashboard and on your landing page.

Both are off by default. Toggle them from **Tenant settings → Feature flags**.
