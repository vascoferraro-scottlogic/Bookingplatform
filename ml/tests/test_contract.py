"""
Contract tests for the /predict endpoint.

These tests validate the JSON request/response schema using FastAPI's
TestClient (httpx-backed). They act as a living contract between the
TypeScript NoShowRiskAgent (which builds the request) and the Python model
service (which consumes it). A failure here means train/serve skew risk or
an API shape change that would break the integration.

No database or trained model is required: the tests check schema validation
only, exercising FastAPI's Pydantic validation layer independently of the
ML model artifact.
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from serve import app


client = TestClient(app, raise_server_exceptions=False)

VALID_REQUEST = {
    "date": "2026-08-01",
    "createdAt": "2026-07-20T10:00:00Z",
    "userCreatedAt": "2024-01-01T09:00:00Z",
    "timeSlot": "14:00",
    "isAllWeather": False,
    "priorNoShowCount": 0,
}


# ── /health ──────────────────────────────────────────────────────────────────

def test_health_returns_200() -> None:
    res = client.get("/health")
    assert res.status_code == 200


def test_health_response_has_required_fields() -> None:
    data = client.get("/health").json()
    assert "status" in data
    assert "modelLoaded" in data
    assert isinstance(data["modelLoaded"], bool)


# ── /predict — request schema ─────────────────────────────────────────────────

def test_predict_rejects_missing_date() -> None:
    payload = {k: v for k, v in VALID_REQUEST.items() if k != "date"}
    res = client.post("/predict", json=payload)
    assert res.status_code == 422


def test_predict_rejects_missing_createdAt() -> None:
    payload = {k: v for k, v in VALID_REQUEST.items() if k != "createdAt"}
    res = client.post("/predict", json=payload)
    assert res.status_code == 422


def test_predict_rejects_missing_userCreatedAt() -> None:
    payload = {k: v for k, v in VALID_REQUEST.items() if k != "userCreatedAt"}
    res = client.post("/predict", json=payload)
    assert res.status_code == 422


def test_predict_rejects_missing_timeSlot() -> None:
    payload = {k: v for k, v in VALID_REQUEST.items() if k != "timeSlot"}
    res = client.post("/predict", json=payload)
    assert res.status_code == 422


def test_predict_rejects_extra_fields() -> None:
    # PredictRequest has extra="forbid" — unknown keys should be rejected
    payload = {**VALID_REQUEST, "unknownExtraField": "hacked"}
    res = client.post("/predict", json=payload)
    assert res.status_code == 422


def test_predict_accepts_optional_fields_absent() -> None:
    # isAllWeather and priorNoShowCount are optional
    payload = {k: v for k, v in VALID_REQUEST.items() if k not in ("isAllWeather", "priorNoShowCount")}
    res = client.post("/predict", json=payload)
    # 422 is schema error; 503 is "model not loaded" (acceptable here)
    assert res.status_code in (200, 503)


# ── /predict — response schema ────────────────────────────────────────────────

def test_predict_response_probability_in_range() -> None:
    # If the model is loaded this gives a real prediction; if not it's 503.
    res = client.post("/predict", json=VALID_REQUEST)
    if res.status_code == 200:
        data = res.json()
        assert "probability" in data
        assert "modelVersion" in data
        assert 0.0 <= data["probability"] <= 1.0
        assert isinstance(data["modelVersion"], str)


def test_predict_503_when_model_not_loaded() -> None:
    # This test checks that when no artifact exists, the endpoint returns 503
    # rather than a 500 with an unhandled exception.
    from serve import runtime
    original_pipeline = runtime.pipeline
    runtime.pipeline = None  # simulate missing artifact
    try:
        res = client.post("/predict", json=VALID_REQUEST)
        assert res.status_code == 503
        assert "not loaded" in res.json()["detail"].lower()
    finally:
        runtime.pipeline = original_pipeline
