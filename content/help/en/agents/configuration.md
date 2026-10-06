---
title: Configuring agents and scheduling runs
category: agents
audience: tenant_admin
tags: [agents, configuration, cron, automation]
order: 40
excerpt: Per-agent settings, environment variables, and how to wire a cron job to run the agents on a schedule.
updated: 2026-05-02
---

## Per-agent config

Each agent reads a JSON config blob. Edit at **Agents → Config**.

### Detector defaults

```json
{
  "sensitivityThreshold": 0.6,
  "autoCreateTasks": true,
  "autoEscalate": true,
  "escalationThreshold": 3,
  "maxTasksPerRun": 5,
  "monitorPrivateChannels": false
}
```

- `sensitivityThreshold` — minimum LLM confidence (0–1) before the agent
  acts. Raise it if you're getting false positives.
- `autoCreateTasks` — when false, the detector only records decisions and
  never creates tasks (useful for trial-runs).
- `autoEscalate` — bumps a task's priority when 3+ people raise the same
  issue within 24 hours.
- `escalationThreshold` — the "3" in the rule above.
- `maxTasksPerRun` — safety cap to prevent runaway task creation.
- `monitorPrivateChannels` — opt in to scanning 1:1 chats. Off by default.

### Triager defaults

```json
{
  "autoAssign": true,
  "autoPrioritise": true,
  "workloadBalancing": true,
  "useWeatherContext": true,
  "maxAssignmentsPerRun": 10
}
```

- `autoAssign` — when false, the triager records its suggested assignee in
  the decision but doesn't apply it. The decision still appears in the
  dashboard so you can adopt or reject the suggestion.
- `autoPrioritise` — same idea for priority changes.
- `workloadBalancing` — factor in each staffer's open task count.
- `useWeatherContext` — fetch the local forecast and feed it into the prompt.

## Environment variables

These belong in your `.env` (or your hosting platform's env config):

| Variable | Purpose |
|---|---|
| `AGENT_LLM_PROVIDER` | `gemini` (default) — or unset to force the stub |
| `AGENT_GEMINI_API_KEY` | Get a key at <https://aistudio.google.com/> |
| `AGENT_GEMINI_MODEL` | Defaults to `gemini-1.5-flash` |
| `AGENT_OWM_API_KEY` | OpenWeatherMap key for triager weather context |
| `AGENT_SECRET` | Bearer token for cron / CLI to hit `/api/agent/run` |
| `AGENT_BASE_URL` | Override the URL the CLI hits — defaults to localhost |
| `AGENT_BATCH_SIZE` | Max chat messages the detector reads per run (default 200) |

## Running on a schedule

Use the npm scripts:

```bash
npm run agent:detect   # detection sweep across all enabled tenants
npm run agent:triage   # triage sweep across all enabled tenants
npm run agent:all      # both, detector first
```

These hit `/api/agent/run` over HTTP using `AGENT_SECRET`. To target one
tenant explicitly:

```bash
node scripts/run-agent.mjs all --tenant lakeview-bowls
```

A typical cron setup runs the detector every 5–15 minutes and the triager
every 30–60 minutes. Both are idempotent and rate-limit-aware (the run is
marked `RATE_LIMITED` if Gemini's free-tier quota is hit; just try again
later).

## Trying it without an LLM

If you don't set `AGENT_GEMINI_API_KEY`, the agents fall back to a stub
provider. Runs complete cleanly but every decision is `NO_ACTION`. Useful
for verifying the plumbing before paying for or signing up for an API key.
