---
title: Curating the agent knowledge base
category: agents
audience: tenant_admin
tags: [agents, knowledge, configuration]
order: 30
excerpt: How knowledge entries shape agent decisions, and how to add club-specific guidance the agents will respect.
updated: 2026-05-02
---

The agents are general-purpose models. They become useful for **your** club
once they know your context — your local climate, your green's quirks, your
event calendar. That context lives in the **knowledge base**.

## Three scopes

Knowledge entries are layered. From broadest to most specific:

| Scope | Who maintains it | Example |
|---|---|---|
| **GLOBAL** | Platform team | "Mowing height — playing season: 4–5 mm" |
| **REGIONAL** | Platform team | "April UK opening — first cut at 8 mm" |
| **TENANT** | Your club admin | "Main Green — SE corner drains poorly" |

When an agent looks up knowledge for a category, more specific scopes win.
A tenant entry on `green_care` for "Mowing" will override a GLOBAL entry
with the same title.

## What's seeded

The `db:seed` script ships with around 20 GLOBAL entries derived from
established turf-care guidance (mowing, irrigation, common diseases, safety
hazards), 3 REGIONAL UK seasonal-calendar entries, and a couple of TENANT
illustrations for the demo club. You can add to all of these.

## Adding a tenant entry

Go to **Agents → Knowledge → + New entry**:

- **Scope**: TENANT
- **Agent**: leave blank to apply to all agents, or pick one
- **Category**: a short tag like `site_specific`, `event_calendar`,
  `local_supplier`, etc. Categories are free-form — use whatever helps you.
- **Title**: a short, distinct title (acts as a dedupe key against other
  entries in the same category)
- **Content**: 1–4 sentences. The whole content is included in the agent's
  prompt verbatim, so be specific and concise.
- **Priority**: bigger numbers float earlier in the prompt. Use 5 for
  important standing rules, 1 for nice-to-have context.

## Categories the agents actually look at

The agents request knowledge by category when relevant:

- **Detector**: `complaint_classification`, `safety` (when severity is in doubt)
- **Triager**: `prioritisation`, `assignment`, `seasonal_calendar`,
  `site_specific`, `safety`

You can add entries in other categories too; they'll only be used if the
agent's prompt happens to surface them.

## Toggling without deleting

Entries have an **active** flag. Deactivate rather than delete when you want
to silence guidance temporarily — useful during shoulder seasons when
some seasonal rules don't apply.
