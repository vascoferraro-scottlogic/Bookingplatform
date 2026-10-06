from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from features import to_frame


ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts"
DATABASE_URL = os.getenv("DATABASE_URL")


def _find_active_artifact() -> tuple[str | None, str | None]:
    """Query the MlModelVersion registry for the ACTIVE artifact path + version."""
    if not DATABASE_URL:
        return None, None
    try:
        from psycopg import connect  # type: ignore[import-untyped]
        with connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'SELECT version, "artifactPath" FROM "MlModelVersion" WHERE status = \'ACTIVE\' LIMIT 1'
                )
                row = cur.fetchone()
                if row:
                    return str(row[0]), str(row[1]) if row[1] else None
    except Exception:
        pass
    # Fallback: legacy single-artifact path for backward compat
    fallback = Path(os.getenv("ML_MODEL_PATH", ARTIFACTS_DIR / "noshow-model.joblib"))
    if fallback.exists():
        return None, str(fallback)
    return None, None


class PredictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: str = Field(description="Booking date (YYYY-MM-DD)")
    createdAt: str = Field(description="Booking creation timestamp (ISO8601)")
    userCreatedAt: str = Field(description="Booker creation timestamp (ISO8601)")
    timeSlot: str = Field(description="Slot start time (HH:MM)")
    isAllWeather: bool = False
    priorNoShowCount: int = 0


class PredictResponse(BaseModel):
    probability: float
    modelVersion: str


class HealthResponse(BaseModel):
    status: str
    modelLoaded: bool
    modelVersion: str | None = None


class ModelRuntime:
    def __init__(self) -> None:
        self.model_version: str | None = None
        self.pipeline: Any | None = None
        self.loaded_at: str | None = None
        self._artifact_path: str | None = None

    def load(self) -> None:
        version, artifact_path = _find_active_artifact()
        if not artifact_path or not Path(artifact_path).exists():
            self.model_version = None
            self.pipeline = None
            return
        payload = joblib.load(artifact_path)
        self.model_version = version or str(payload.get("modelVersion", "noshow-v1"))
        self.pipeline = payload["pipeline"]
        self.loaded_at = datetime.now(timezone.utc).isoformat()
        self._artifact_path = artifact_path


runtime = ModelRuntime()
runtime.load()

app = FastAPI(title="Booking No-Show ML", version="1.0.0")


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        modelLoaded=runtime.pipeline is not None,
        modelVersion=runtime.model_version,
    )


@app.get("/version")
def version() -> dict[str, Any]:
    if runtime.pipeline is None:
        raise HTTPException(status_code=503, detail="Model artifact not loaded")
    return {
        "modelVersion": runtime.model_version,
        "artifactPath": runtime._artifact_path,
        "loadedAt": runtime.loaded_at,
    }


@app.post("/reload")
def reload() -> dict[str, Any]:
    """Reload the ACTIVE model artifact from the registry. Called after promotion."""
    old_version = runtime.model_version
    runtime.load()
    return {
        "previousVersion": old_version,
        "currentVersion": runtime.model_version,
        "modelLoaded": runtime.pipeline is not None,
        "reloadedAt": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/train")
def train_model(request: Request) -> dict[str, Any]:
    """Trigger a training run. Requires ML_TRAIN_SECRET bearer token."""
    train_secret = os.getenv("ML_TRAIN_SECRET")
    if train_secret:
        auth = request.headers.get("Authorization", "")
        if auth != f"Bearer {train_secret}":
            raise HTTPException(status_code=401, detail="Unauthorized")
    if not DATABASE_URL:
        raise HTTPException(status_code=503, detail="DATABASE_URL not configured")
    try:
        from train import train
        metrics = train()
        return metrics
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest) -> PredictResponse:
    if runtime.pipeline is None:
        raise HTTPException(status_code=503, detail="Model artifact not loaded")

    frame = to_frame([req.model_dump()])
    probability = float(runtime.pipeline.predict_proba(frame)[:, 1][0])
    return PredictResponse(probability=probability, modelVersion=runtime.model_version or "noshow-v1")


@app.post("/drift")
def drift_check() -> dict[str, Any]:
    """Run a windowed drift check and write an MlDriftCheck row."""
    if not DATABASE_URL:
        raise HTTPException(status_code=503, detail="DATABASE_URL not configured")
    try:
        from drift import run_drift_check
        result = run_drift_check(DATABASE_URL)
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
