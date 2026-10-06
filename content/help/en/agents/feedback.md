---
title: Reviewing decisions and giving feedback
category: agents
audience: tenant_admin
tags: [agents, feedback, learning]
order: 20
excerpt: How to use the Agents dashboard to validate or correct what the agents did — and why your feedback matters.
updated: 2026-05-02
---

Every action an agent takes is recorded as a **decision** with a reasoning
note and a confidence score. Maintenance staff and admins can review these
on the **Agents** dashboard.

## Two levels of feedback

The detector and triager ask different questions, so the feedback pills
differ:

- **Detector decisions** — was this actually a complaint?
  - **✓ Correct** — yes, the agent rightly raised this
  - **✗ Wrong** — no, this wasn't a real complaint
- **Triager decisions** — was the priority and assignment right?
  - **Priority**: Right / Too high / Too low
  - **Assignment**: Right person / Wrong person

You can also leave a free-text **note** explaining the correction. Notes are
private to your club.

## Why bother

Feedback is the agent's only learning signal. The dashboard's accuracy stats
(top of the page) come straight from these pills:

- **With feedback %** — how often staff are reviewing decisions
- **Marked correct %** — accuracy on the reviewed subset
- **Avg confidence** — how confident the agent is across the last 50 decisions

Low feedback rate + high confidence = you're flying blind. Aim for at least
50% feedback coverage on the first 100 decisions to calibrate the agent.

## What the agent does with feedback

Right now: feedback is stored against each decision and surfaces in the
stats panel. Future iterations of the agents will read recent feedback into
their prompts so they self-correct (e.g. "the last 5 'leak' complaints were
marked Too High — be more conservative with leak severity").

## When to override vs give feedback

- **Override** = change the task's priority or assignee yourself in the
  Maintenance page. Always works, immediate effect.
- **Feedback** = tell the agent it was wrong, without changing the task.

Use feedback when the agent's decision was wrong but the task is fine
as-is. Use override when you need to change the actual task.
