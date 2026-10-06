from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterable

import pandas as pd


@dataclass(frozen=True)
class FeatureRow:
    lead_time_days: float
    day_of_week: int
    month: int
    hour_of_day: int
    is_weekend: int
    is_all_weather: int
    tenure_days: float
    prior_no_show_count: float


def _parse_date(value: Any) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        return datetime.fromisoformat(value[:10]).date()
    raise ValueError(f"Unsupported date value: {value!r}")


def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    raise ValueError(f"Unsupported datetime value: {value!r}")


def _parse_hour(time_slot: Any) -> int:
    if isinstance(time_slot, str) and len(time_slot) >= 2:
        return max(0, min(23, int(time_slot[:2])))
    raise ValueError(f"Unsupported timeSlot value: {time_slot!r}")


def row_from_raw(raw: dict[str, Any]) -> FeatureRow:
    play_date = _parse_date(raw["date"])
    created_at = _parse_datetime(raw["createdAt"])
    user_created_at = _parse_datetime(raw["userCreatedAt"])
    hour = _parse_hour(raw["timeSlot"])

    lead_time_days = max(0.0, (play_date - created_at.date()).days)
    tenure_days = max(0.0, (play_date - user_created_at.date()).days)
    dow = play_date.weekday()

    return FeatureRow(
        lead_time_days=float(lead_time_days),
        day_of_week=int(dow),
        month=int(play_date.month),
        hour_of_day=int(hour),
        is_weekend=1 if dow >= 5 else 0,
        is_all_weather=1 if bool(raw.get("isAllWeather", False)) else 0,
        tenure_days=float(tenure_days),
        prior_no_show_count=float(raw.get("priorNoShowCount") or 0),
    )


def to_frame(rows: Iterable[dict[str, Any]]) -> pd.DataFrame:
    data = [row_from_raw(r).__dict__ for r in rows]
    if not data:
        return pd.DataFrame(
            columns=[
                "lead_time_days",
                "day_of_week",
                "month",
                "hour_of_day",
                "is_weekend",
                "is_all_weather",
                "tenure_days",
                "prior_no_show_count",
            ]
        )
    return pd.DataFrame(data)
