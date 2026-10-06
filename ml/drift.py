"""
drift.py — Windowed drift detection for the no-show prediction model.

Computes ROC-AUC, Expected Calibration Error (ECE), and positive rate over a
rolling window of BookingNoShowPrediction rows whose outcomes are known (i.e.
actualNoShow is not null). Compares against the training metrics stored in
MlModelVersion to produce a HEALTHY / WARN / DRIFT status.

Writes a MlDriftCheck row to the database.

Thresholds (conservative defaults — adjust via env or operator config):
  WARN  : rocAuc drops >0.05 below training, or calibrationError > 0.15
  DRIFT : rocAuc drops >0.10 below training, or calibrationError > 0.25
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from dotenv import load_dotenv

load_dotenv()


def _ece(probs: list[float], labels: list[int], n_bins: int = 10) -> float:
    """Expected Calibration Error across n_bins of equal width."""
    if not probs:
        return 0.0
    total = len(probs)
    ece = 0.0
    for b in range(n_bins):
        lo = b / n_bins
        hi = (b + 1) / n_bins
        in_bin = [(p, y) for p, y in zip(probs, labels) if lo <= p < hi]
        if not in_bin:
            continue
        avg_conf = sum(p for p, _ in in_bin) / len(in_bin)
        acc = sum(y for _, y in in_bin) / len(in_bin)
        ece += (len(in_bin) / total) * abs(avg_conf - acc)
    return ece


def _roc_auc(labels: list[int], probs: list[float]) -> float | None:
    """Trapezoidal ROC-AUC. Returns None if both classes aren't present."""
    pos = sum(labels)
    neg = len(labels) - pos
    if pos == 0 or neg == 0:
        return None

    paired = sorted(zip(probs, labels), key=lambda x: -x[0])
    tp = fp = 0
    auc = 0.0
    prev_tp = prev_fp = 0
    for p, y in paired:
        if y == 1:
            tp += 1
        else:
            fp += 1
        tpr = tp / pos
        fpr = fp / neg
        prev_fpr = prev_fp / neg
        auc += (fpr - prev_fpr) * ((tpr + prev_tp / pos) / 2)
        prev_tp = tp
        prev_fp = fp
    return auc


def run_drift_check(
    database_url: str,
    window_days: int = 30,
    warn_auc_drop: float = 0.05,
    drift_auc_drop: float = 0.10,
    warn_ece: float = 0.15,
    drift_ece: float = 0.25,
) -> dict[str, Any]:
    from psycopg import connect

    now = datetime.now(timezone.utc)
    window_start = now - timedelta(days=window_days)

    with connect(database_url) as conn:
        with conn.cursor() as cur:
            # Get active model version + training metrics
            cur.execute(
                'SELECT version, "rocAuc", "labelRate" FROM "MlModelVersion" WHERE status = \'ACTIVE\' LIMIT 1'
            )
            version_row = cur.fetchone()
            if not version_row:
                raise RuntimeError("No ACTIVE model version found. Train a model first.")
            model_version, train_roc_auc, train_label_rate = version_row

            # Fetch predictions with known outcomes in the window
            cur.execute(
                """
                SELECT probability, "actualNoShow"
                FROM "BookingNoShowPrediction"
                WHERE "modelVersion" = %s
                  AND "predictedAt" >= %s
                  AND "actualNoShow" IS NOT NULL
                """,
                (model_version, window_start),
            )
            rows = cur.fetchall()

    if len(rows) < 10:
        raise RuntimeError(
            f"Not enough labelled predictions in the window ({len(rows)} found, need ≥10). "
            "Wait for more bookings to be marked as no-show or confirmed."
        )

    probs = [float(r[0]) for r in rows]
    labels = [1 if r[1] else 0 for r in rows]

    roc_auc = _roc_auc(labels, probs)
    ece = _ece(probs, labels)
    positive_rate = sum(labels) / len(labels)

    delta_roc_auc = (roc_auc - float(train_roc_auc)) if (roc_auc is not None and train_roc_auc is not None) else None

    # Determine status
    status = "HEALTHY"
    if roc_auc is not None and delta_roc_auc is not None:
        if delta_roc_auc < -drift_auc_drop or ece > drift_ece:
            status = "DRIFT"
        elif delta_roc_auc < -warn_auc_drop or ece > warn_ece:
            status = "WARN"

    result: dict[str, Any] = {
        "modelVersion": model_version,
        "windowStart": window_start.isoformat(),
        "windowEnd": now.isoformat(),
        "sampleCount": len(rows),
        "rocAuc": roc_auc,
        "calibrationError": ece,
        "positiveRate": positive_rate,
        "deltaRocAuc": delta_roc_auc,
        "deltaCalibration": None,  # could compare to training ECE if stored
        "status": status,
    }

    # Write MlDriftCheck row
    with connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO "MlDriftCheck" (
                    id, "modelVersion", "checkedAt", "windowStart", "windowEnd",
                    "sampleCount", "rocAuc", "calibrationError", "positiveRate",
                    "deltaRocAuc", "deltaCalibration", status
                ) VALUES (
                    gen_random_uuid()::text, %s, NOW(), %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s
                )
                """,
                (
                    model_version,
                    window_start,
                    now,
                    len(rows),
                    roc_auc,
                    ece,
                    positive_rate,
                    delta_roc_auc,
                    None,
                    status,
                ),
            )
        conn.commit()

    return result


if __name__ == "__main__":
    import json as _json
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required")
    out = run_drift_check(database_url)
    print(_json.dumps(out, indent=2))
