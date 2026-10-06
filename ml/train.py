from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv()

import joblib
import numpy as np
import pandas as pd
from psycopg import connect
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    precision_recall_fscore_support,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from features import to_frame


ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"
METRICS_PATH = Path(os.getenv("ML_METRICS_PATH", ARTIFACTS_DIR / "metrics.json"))


def _resolve_version(database_url: str) -> str:
    """Auto-bump version based on the highest existing noshow-vN in the registry."""
    try:
        with connect(database_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'SELECT version FROM "MlModelVersion" WHERE version ~ \'^noshow-v[0-9]+$\''
                )
                rows = cur.fetchall()
        if not rows:
            return "noshow-v1"
        nums = [int(re.search(r"(\d+)$", r[0]).group(1)) for r in rows]  # type: ignore[union-attr]
        return f"noshow-v{max(nums) + 1}"
    except Exception:
        return "noshow-v1"


def _write_version_row(database_url: str, version: str, metrics: dict[str, Any], artifact_path: str) -> None:
    """Insert/update an MlModelVersion row with training results."""
    with connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO "MlModelVersion" (
                    id, version, status, "artifactPath", "trainedAt",
                    "rowsTotal", "rowsTrain", "rowsTest", "labelRate",
                    "rocAuc", "averagePrecision", brier, precision, recall, f1,
                    threshold, "featureSet", coefficients, "createdAt", "updatedAt"
                ) VALUES (
                    gen_random_uuid()::text, %s, %s, %s, NOW(),
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, NOW(), NOW()
                )
                ON CONFLICT (version) DO UPDATE SET
                    status = EXCLUDED.status,
                    "artifactPath" = EXCLUDED."artifactPath",
                    "trainedAt" = EXCLUDED."trainedAt",
                    "rowsTotal" = EXCLUDED."rowsTotal",
                    "rowsTrain" = EXCLUDED."rowsTrain",
                    "rowsTest" = EXCLUDED."rowsTest",
                    "labelRate" = EXCLUDED."labelRate",
                    "rocAuc" = EXCLUDED."rocAuc",
                    "averagePrecision" = EXCLUDED."averagePrecision",
                    brier = EXCLUDED.brier,
                    precision = EXCLUDED.precision,
                    recall = EXCLUDED.recall,
                    f1 = EXCLUDED.f1,
                    threshold = EXCLUDED.threshold,
                    "featureSet" = EXCLUDED."featureSet",
                    coefficients = EXCLUDED.coefficients,
                    "updatedAt" = NOW()
                """,
                (
                    version,
                    "TRAINED",
                    artifact_path,
                    metrics["rowsTotal"],
                    metrics["rowsTrain"],
                    metrics["rowsTest"],
                    metrics["labelRate"],
                    metrics["rocAuc"],
                    metrics["averagePrecision"],
                    metrics["brier"],
                    metrics["precision"],
                    metrics["recall"],
                    metrics["f1"],
                    metrics["threshold"],
                    json.dumps(metrics.get("featureSet", [])),
                    json.dumps(metrics.get("coefficients", {})),
                ),
            )
        conn.commit()


def _bootstrap_promote(database_url: str, version: str, artifact_path: str) -> bool:
    """Promote version to ACTIVE only if no current ACTIVE champion exists."""
    with connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute('SELECT COUNT(*) FROM "MlModelVersion" WHERE status = \'ACTIVE\'')
            count = cur.fetchone()[0]  # type: ignore[index]
            if count == 0:
                cur.execute(
                    'UPDATE "MlModelVersion" SET status = \'ACTIVE\', "promotedAt" = NOW(), "updatedAt" = NOW() WHERE version = %s',
                    (version,),
                )
                conn.commit()
                return True
    return False



def fetch_training_rows(database_url: str) -> list[dict[str, Any]]:
    sql = """
        SELECT
            b.id,
            b.date,
            b."createdAt",
            u."createdAt" AS "userCreatedAt",
            COALESCE(bs."timeSlot", '14:00') AS "timeSlot",
            COALESCE(g."allWeather", FALSE) AS "isAllWeather",
            (
              SELECT COUNT(*)
              FROM "Booking" b2
              WHERE b2."tenantId" = b."tenantId"
                AND b2."userId" = b."userId"
                AND b2.status = 'NO_SHOW'
                AND b2.date < b.date
            )::int AS "priorNoShowCount",
            CASE WHEN b.status = 'NO_SHOW' THEN 1 ELSE 0 END AS label
        FROM "Booking" b
        JOIN "User" u ON u.id = b."userId"
        LEFT JOIN "BookingSlot" bs ON bs."bookingId" = b.id
        LEFT JOIN "Rink" r ON r.id = bs."rinkId"
        LEFT JOIN "Green" g ON g.id = r."greenId"
        WHERE b.status IN ('CONFIRMED', 'NO_SHOW')
        ORDER BY b.date ASC, b."createdAt" ASC
    """
    with connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            cols = [d.name for d in cur.description]
            rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    return rows


def build_pipeline() -> Pipeline:
    numeric_features = [
        "lead_time_days",
        "hour_of_day",
        "is_weekend",
        "is_all_weather",
        "tenure_days",
        "prior_no_show_count",
    ]
    categorical_features = ["day_of_week", "month"]

    numeric_transformer = Pipeline(
        steps=[("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler())]
    )
    categorical_transformer = Pipeline(
        steps=[
            ("impute", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore")),
        ]
    )

    preprocessor = ColumnTransformer(
        transformers=[
            ("num", numeric_transformer, numeric_features),
            ("cat", categorical_transformer, categorical_features),
        ]
    )

    model = LogisticRegression(max_iter=200, class_weight="balanced")
    return Pipeline(steps=[("preprocess", preprocessor), ("model", model)])


def _extract_coefficients(pipeline: Pipeline, numeric_features: list[str], categorical_features: list[str]) -> dict[str, float]:
    """Return {feature_name: coefficient} from the fitted pipeline for the importance panel."""
    try:
        preprocessor: ColumnTransformer = pipeline.named_steps["preprocess"]
        model: LogisticRegression = pipeline.named_steps["model"]
        coefs = model.coef_[0]

        # Reconstruct feature names in the order the preprocessor outputs them
        cat_transformer = preprocessor.named_transformers_["cat"]
        cat_feature_names: list[str] = list(
            cat_transformer.named_steps["onehot"].get_feature_names_out(categorical_features)
        )
        all_features = numeric_features + cat_feature_names
        return {name: float(coefs[i]) for i, name in enumerate(all_features) if i < len(coefs)}
    except Exception:
        return {}


def train() -> dict[str, Any]:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required")

    model_version = _resolve_version(database_url)

    rows = fetch_training_rows(database_url)
    if len(rows) < 50:
        raise RuntimeError(f"Need at least 50 labelled bookings, found {len(rows)}")

    labels = [int(r.pop("label")) for r in rows]
    x = to_frame(rows)
    y = pd.Series(labels)

    if y.nunique() < 2:
        raise RuntimeError("Need both CONFIRMED and NO_SHOW rows for training")

    x_train, x_test, y_train, y_test = train_test_split(
        x, y, test_size=0.25, random_state=42, stratify=y
    )

    numeric_features = [
        "lead_time_days",
        "hour_of_day",
        "is_weekend",
        "is_all_weather",
        "tenure_days",
        "prior_no_show_count",
    ]
    categorical_features = ["day_of_week", "month"]

    pipeline = build_pipeline()
    pipeline.fit(x_train, y_train)

    # Threshold matches the operational riskThreshold in NoShowRiskAgent (0.4)
    THRESHOLD = 0.4
    probs = pipeline.predict_proba(x_test)[:, 1]
    preds = (probs >= THRESHOLD).astype(int)

    precision, recall, f1, _ = precision_recall_fscore_support(
        y_test, preds, average="binary", zero_division=0
    )

    coefficients = _extract_coefficients(pipeline, numeric_features, categorical_features)
    feature_set = numeric_features + categorical_features

    metrics = {
        "modelVersion": model_version,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "rowsTotal": int(len(rows)),
        "rowsTrain": int(len(x_train)),
        "rowsTest": int(len(x_test)),
        "labelRate": float(y.mean()),
        "rocAuc": float(roc_auc_score(y_test, probs)),
        "averagePrecision": float(average_precision_score(y_test, probs)),
        "brier": float(brier_score_loss(y_test, probs)),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "threshold": THRESHOLD,
        "featureSet": feature_set,
        "coefficients": coefficients,
    }

    # Artifact named by version so old ones aren't overwritten
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    artifact_path = str(ARTIFACTS_DIR / f"{model_version}.joblib")
    payload = {"modelVersion": model_version, "pipeline": pipeline, "metrics": metrics}
    joblib.dump(payload, artifact_path)

    # Keep metrics.json for backward compat / quick inspection
    METRICS_PATH.parent.mkdir(parents=True, exist_ok=True)
    METRICS_PATH.write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    # Write to the model registry, then bootstrap-promote if no active champion
    _write_version_row(database_url, model_version, metrics, artifact_path)
    promoted = _bootstrap_promote(database_url, model_version, artifact_path)
    metrics["bootstrapPromoted"] = promoted

    return metrics


if __name__ == "__main__":
    out = train()
    print(json.dumps(out, indent=2))
