---
title: How the maintenance agents work
category: agents
audience: tenant_admin
tags: [agents, maintenance, ai, automation]
order: 10
excerpt: An overview of the Detection and Triage agents, what they do automatically, and where you stay in control.
updated: 2026-05-02
---

The agents are an optional layer of automation that watches your club's chat
and your maintenance backlog and tries to move them along faster. There are
two agents and they're independent — you can enable one without the other.

## The Detection Agent

**What it does**: reads new messages in your club's public and group chat
channels, identifies anything that looks like a complaint about facilities,
and either:

- **Creates a new maintenance task** for it (default), or
- **Adds context to an existing open task** when the same issue is mentioned
  again, and **escalates** the task's priority if the same issue is mentioned
  by 3 or more people in 24 hours.

It will **not** read private 1:1 chats by default. You can opt in via the
agent's config if you want it to.

## The Triage Agent

**What it does**: looks at submitted but unassigned maintenance tasks and
suggests (or applies) a priority and an assignee, taking into account:

- Each maintenance staffer's current open task count
- The local weather forecast for the next few days
- Recent maintenance activity (so it doesn't double-assign mowing the same
  green twice in 48h)
- Knowledge entries you've added to the knowledge base

## How to turn them on

Both agents respect the **`agent`** feature flag. They also respect a
per-agent enabled toggle in **Agents → Config**, so you can disable just one.

When run, each agent records every action it takes as a **decision** —
visible on the **Agents** dashboard. Click into the dashboard to see what
the agent did, why, and to give it feedback.

## What they cost you

The agents call an LLM provider (Google Gemini by default — free tier is
sufficient for normal club traffic). If no API key is configured the agents
fall back to a stub provider that records "no-op" decisions, so the rest of
the platform keeps working.

## What they don't do (yet)

- They don't post in chat or message members directly.
- They don't close tasks — only humans close tasks.
- They don't reassign already-assigned tasks unless you ask them to.
