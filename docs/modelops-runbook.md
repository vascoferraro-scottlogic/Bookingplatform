# ModelOps Runbook — Booking No-Show Prediction

Everything ye need to operate the no-show ML model: adding features,
running training jobs, checking drift, and promoting or rolling back versions.

---

## Architecture at a glance

```
PostgreSQL ──────────────────────────────────────────────────────────────────
  BookingNoShowPrediction   prediction per booking per model version
  MlModelVersion            training registry: metrics, status, coefficients
  MlDriftCheck              windowed drift reports
  MlFeatureDefinition       feature registry: AVAILABLE / ENROLLED / RETIRED

Python sidecar (ml/)  ── FastAPI on port 8001
  /predict              score an individual booking (called by the agent)
  /train                retrain; auto-bumps version; writes MlModelVersion
  /reload               reload the ACTIVE artifact after promotion
  /drift                compute windowed drift; writes MlDriftCheck
  /health               liveness + model-loaded status

Next.js app (src/)
  NoShowRiskAgent       calls /predict nightly; persists predictions; emits
                        BOOKING_NOSHOW_REMINDER proposals into the admin inbox
  /api/admin/model/*    retrain, drift-check, health, features (platform-admin)
  /dashboard/platform/model-health   operator dashboard

CLI scripts
  npm run ml:train      direct Python retrain (local dev / bypass app layer)
  npm run ml:retrain    retrain + promotion gate via the app layer
  npm run ml:drift      drift check via the app layer
  npm run eval:noshow   manual eval script (reads predictions table)
  node scripts/run-ml.mjs retrain|drift   cron-friendly variant
```

---

## Operator day-to-day

### Check model health
Open `/dashboard/platform/model-health` (platform-admin only).

The page shows:
- Active version KPIs (ROC-AUC, F1, Recall, Precision, threshold, row count)
- ML sidecar status (online / model loaded)
- Latest drift check (HEALTHY / WARN / DRIFT) with Δ ROC-AUC
- Feature registry (enrolled, available, retired)
- Feature importance (coefficient bar chart — red = raises risk, blue = lowers)
- Version history table

### Retrain the model
Click **Retrain model** in the dashboard, or run from a cron job:

```bash
node scripts/run-ml.mjs retrain
```

This:
1. Calls `POST /train` on the sidecar — trains on all ENROLLED features using
   CONFIRMED + NO_SHOW bookings from Postgres.
2. Auto-bumps the version (`noshow-v2`, `noshow-v3`, …).
3. Writes an `MlModelVersion` row (status=TRAINED).
4. Applies the champion/challenger gate:
   - No current ACTIVE version → bootstrap-promote.
   - Challenger ROC-AUC ≥ champion ROC-AUC − 0.02 → promote (archive old champion).
   - Otherwise → reject (status=REJECTED, notes explain the gap).
5. If promoted → calls `/reload` so the sidecar starts serving the new model.

The gate tolerance (0.02 = 2pp) is in
`src/app/api/admin/model/retrain/route.ts:ROC_AUC_TOLERANCE`. Adjust if needed.

### Run a drift check
Click **Run drift check** in the dashboard, or:

```bash
node scripts/run-ml.mjs drift
```

This:
1. Calls `POST /drift` on the sidecar.
2. Fetches `BookingNoShowPrediction` rows for the ACTIVE version where
   `actualNoShow IS NOT NULL` and `predictedAt >= now - 30 days`.
3. Computes windowed ROC-AUC and ECE; compares to training metrics.
4. Writes an `MlDriftCheck` row.
5. Returns HEALTHY / WARN / DRIFT.

Thresholds (in `ml/drift.py`):

| Status | Condition |
|--------|-----------|
| WARN   | Δ ROC-AUC < −0.05  OR  ECE > 0.15 |
| DRIFT  | Δ ROC-AUC < −0.10  OR  ECE > 0.25 |

A DRIFT result warrants retraining. A persistent WARN may indicate data shift —
check whether the member/booking mix has changed significantly.

Drift check requires ≥10 `BookingNoShowPrediction` rows with `actualNoShow IS NOT NULL`
in the 30-day window. In production this accrues naturally as bookings settle to NO_SHOW
or CONFIRMED and the agent runs nightly. For local dev / QE setup, prime the pump:

```bash
# 1. Seed base data (tenants, rinks, members)
npx prisma db seed

# 2. Seed synthetic labelled booking history
npx tsx scripts/seed-noshow-history.ts --tenant lakeview-bowls --count 400

# 3. Train a model (creates the ACTIVE version)
curl -s -X POST http://localhost:8001/train

# 4. Reload the sidecar
curl -s -X POST http://localhost:8001/reload

# 5. Backfill prediction rows with outcomes (dev only — skips the agent)
node --env-file=.env scripts/backfill-noshow-predictions.mjs
```

### Roll back a model
There is no one-click rollback in the UI. To roll back to a previous version:

1. Find the version in the history table and note its `artifactPath`.
2. In the database, set the current ACTIVE version to ARCHIVED and the previous
   version to ACTIVE (`promotedAt = now()`).
3. Call `POST /reload` (or restart the sidecar) to pick up the new ACTIVE artifact.
4. Verify with `GET /health` that `modelVersion` reflects the rollback.

---

## Adding a new feature

Follow these steps end to end. Missing any step causes train/serve skew.

### Step 1 — Add compute to `ml/features.py`

Add the new field to `FeatureRow`, compute it in `row_from_raw()`, and include
it in the explicit column list in `to_frame()`.

```python
# features.py

@dataclass(frozen=True)
class FeatureRow:
    ...
    cancellation_rate: float       # ← new field

def row_from_raw(raw: dict) -> FeatureRow:
    ...
    cancellation_rate = float(raw.get("cancellationRate") or 0.0)
    return FeatureRow(
        ...
        cancellation_rate=cancellation_rate,
    )

def to_frame(rows):
    data = [row_from_raw(r).__dict__ for r in rows]
    if not data:
        return pd.DataFrame(columns=[
            ...,
            "cancellation_rate",        # ← add here
        ])
    return pd.DataFrame(data)
```

**Skew-safe contract**: `features.py` always computes ALL fields. The train
pipeline selects which ones to use from the ENROLLED set in the DB.
`serve.py` uses whatever columns the fitted pipeline was trained on (encapsulated
inside the joblib artifact). So adding compute here never breaks serving.

### Step 2 — Add the SQL to `ml/train.py:fetch_training_rows`

```python
SELECT
    ...
    (
        SELECT COUNT(*) FROM "Booking" b2
        WHERE b2."userId" = b."userId" AND b2."tenantId" = b."tenantId"
          AND b2.status = 'CANCELLED'
    )::float /
    NULLIF((
        SELECT COUNT(*) FROM "Booking" b3
        WHERE b3."userId" = b."userId" AND b3."tenantId" = b."tenantId"
          AND b3.status IN ('CONFIRMED', 'CANCELLED', 'NO_SHOW')
    ), 0) AS "cancellationRate",
    ...
```

### Step 3 — Expose the field on `ml/serve.py:PredictRequest`

```python
class PredictRequest(BaseModel):
    ...
    cancellationRate: float = 0.0   # ← optional (default 0 keeps backward compat)
```

The field must be optional so that the current live agent (which doesn't send it
yet) continues to work while the feature is AVAILABLE but not yet enrolled.

### Step 4 — Pass the field from the TS agent

In `src/lib/agent/ml-client.ts`:

```typescript
export interface NoShowPredictRequest {
  ...
  cancellationRate: number;
}
```

In `src/lib/agent/agents/no-show.ts`, compute and include the value:

```typescript
const req: NoShowPredictRequest = {
  ...
  cancellationRate: cancellationRates.get(booking.userId) ?? 0,
};
```

Pre-compute cancellation rates in a batch query (avoid N+1) the same way
`priorNoShowCounts` is computed.

### Step 5 — Register in the feature registry

Add a seed upsert in `prisma/seed.ts:seedMlFeatures`:

```typescript
{ key: "cancellation_rate", label: "Cancellation rate", kind: "NUMERIC",
  description: "Fraction of past bookings cancelled by this member." },
```

Run `npm run db:seed` (or a one-off `tsx` invocation) to insert the row.
It will appear in the dashboard with status **AVAILABLE**.

### Step 6 — Operator enrolls the feature

In `/dashboard/platform/model-health`, the feature appears in the Feature
Registry with an **Enroll** button. Click it. Status changes to ENROLLED.

Alternatively via API:

```bash
curl -X PATCH http://localhost:3000/api/admin/model/features/cancellation_rate \
  -H "Authorization: Bearer $AGENT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"enroll"}'
```

### Step 7 — Retrain

```bash
npm run ml:retrain
```

The new version's `featureSet` JSON will include `cancellation_rate`. The
champion/challenger gate ensures the new model is at least as good as the old
one before it goes live.

### Step 8 — Verify

After promotion:
- `GET /health` → `modelLoaded: true`, `modelVersion: noshow-vN`
- Dashboard → Feature Importance panel shows `cancellation_rate` with a
  coefficient.
- `npm run eval:noshow` → metrics reflect the new model.

---

## Retiring a feature

1. In the dashboard click **Retire** next to the feature, or:
   ```bash
   curl -X PATCH .../features/<key> -d '{"action":"retire"}'
   ```
2. Status changes to RETIRED. The current live model still uses it (it was baked
   in at training time).
3. On next retrain the feature is excluded from the `ColumnTransformer`.

---

## Train/serve skew — what to check

The most dangerous operational error. If the model was trained on feature X
but the sidecar receives a different value (or nothing) for X, predictions
are silently wrong.

**Guards in place:**
- `features.py` is the single source of truth for feature computation.
- `PredictRequest` fields are optional with safe defaults (0 / false) so old
  agents don't crash.
- The joblib artifact encapsulates the `ColumnTransformer` including column
  names, so the sidecar can only use columns it was trained on.
- `test_contract.py` rejects requests with extra fields (`extra="forbid"`) and
  missing required fields.

**What to watch:**
- After adding a field to `NoShowPredictRequest` (TS), verify the corresponding
  `PredictRequest` field exists in `serve.py` (Python). The contract tests cover
  this for required fields; optional fields need manual cross-checking.
- After retraining with a new feature, the old `noshow-vN.joblib` artifact still
  works for serving because it doesn't know about the new feature. Only the new
  `noshow-v(N+1).joblib` uses it.

---

## Environment variables

| Variable            | Where used                    | Description                                              |
|---------------------|-------------------------------|----------------------------------------------------------|
| `DATABASE_URL`      | Python (train, drift, serve)  | Postgres connection string                               |
| `ML_SERVICE_URL`    | TS agent + API routes         | Sidecar base URL (default `http://localhost:8001`)       |
| `ML_TRAIN_SECRET`   | serve.py `/train`             | Bearer token protecting the /train endpoint (optional)   |
| `AGENT_SECRET`      | run-ml.mjs                    | Bearer token for the Next.js admin API endpoints         |
| `AGENT_BASE_URL`    | run-ml.mjs                    | App base URL (default `http://localhost:3000`)           |
| `ML_METRICS_PATH`   | train.py                      | Path for metrics.json (default `ml/artifacts/metrics.json`) |

---

## Cron / scheduled jobs (production)

These scripts are cron-ready. Suggested cadence:

| Job | Command | Cadence |
|-----|---------|---------|
| Predict (agent) | `node scripts/run-agent.mjs no-show --all-tenants` | Nightly 02:00 |
| Drift check | `node scripts/run-ml.mjs drift` | Daily 03:00 |
| Retrain | `node scripts/run-ml.mjs retrain` | Weekly Sunday 04:00 |

All jobs require `AGENT_SECRET` and `AGENT_BASE_URL` in the environment.
