---
title: No-show prediction
category: bookings
audience: tenant_admin
tags: [bookings, machine-learning, no-show, reminders]
order: 40
excerpt: How the platform automatically identifies high-risk bookings and helps you send proactive reminders.
updated: 2026-06-18
---

The platform includes a machine-learning model that estimates the probability of a confirmed booking becoming a no-show. When the risk is high enough, the model raises a reminder proposal in the agent inbox so you can send the member a nudge before their play date.

## How it works

1. **Prediction** — Each night (or on demand with `npm run agent:noshow`) the no-show agent scores all upcoming confirmed and reserved bookings against the model. The model considers factors like how far in advance the booking was made, the day of week, time of day, whether the green is all-weather, and the member's history.

2. **Proposal** — Bookings with a predicted no-show probability of **40% or higher** appear in the agent inbox (`/dashboard/agents/inbox`) as **BOOKING_NOSHOW_REMINDER** proposals.

3. **Approval** — Review the proposal and click **Approve** to send an email reminder to the member. The message is queued as a STUBBED outbound email (visible in the platform messaging inspector) and will be dispatched once the real email provider is configured.

4. **Ground truth** — After a play date passes, mark bookings whose member didn't show as **No-show** using the button on the bookings page. This is the label the model trains on. The more consistently you mark no-shows, the more accurate the model becomes over time.

## Marking a booking as a no-show

1. Go to **Bookings** in the sidebar.
2. Find a confirmed booking whose date has passed.
3. Click **Mark no-show**.

The button is only visible to tenant admins and only appears once the booking's date has passed. The booking moves to **NO_SHOW** status and the outcome is recorded in the model's history.

## Retraining the model

As ground-truth labels accumulate, retrain the model with:

```bash
python3 ml/train.py
```

Or via Docker:

```bash
docker compose run --rm ml-noshow python train.py
```

New metrics are written to `ml/artifacts/metrics.json`. Restart the sidecar to pick them up.

## Evaluating model performance

```bash
npm run eval:noshow
# or for a specific tenant:
npx tsx scripts/eval-noshow.ts --tenant lakeview-bowls
```

The output shows precision, recall, F1, ROC-AUC, and a calibration table by decile.

## Configuring the risk threshold

The default risk threshold is **40%**. To adjust it, update the `AgentConfig` row for the `no-show` agent on your tenant. For example, raising it to 0.6 reduces the number of proposals but increases precision (fewer false alarms).

:::platform-admin
The model runs as a Python sidecar service (`ml-noshow`) alongside the main application. The service exposes `GET /health` and `GET /version` for monitoring. If the sidecar is unavailable, the agent logs a `NO_ACTION` decision for each booking and completes cleanly — no bookings are skipped permanently.
:::
