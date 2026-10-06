import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
import pandas as pd
from features import to_frame, row_from_raw, FeatureRow


BASE_ROW = {
    "date": "2026-06-01",
    "createdAt": "2026-05-20T10:00:00Z",
    "userCreatedAt": "2024-01-01T09:00:00Z",
    "timeSlot": "14:00",
    "isAllWeather": False,
    "priorNoShowCount": 0,
}


def test_to_frame_builds_expected_columns() -> None:
    frame = to_frame([{**BASE_ROW, "isAllWeather": True, "priorNoShowCount": 2}])

    assert frame.shape[0] == 1
    assert set(frame.columns) == {
        "lead_time_days",
        "day_of_week",
        "month",
        "hour_of_day",
        "is_weekend",
        "is_all_weather",
        "tenure_days",
        "prior_no_show_count",
    }
    assert frame.iloc[0]["hour_of_day"] == 14
    assert frame.iloc[0]["is_all_weather"] == 1


def test_lead_time_is_positive() -> None:
    row = row_from_raw(BASE_ROW)
    # 2026-06-01 - 2026-05-20 = 12 days
    assert row.lead_time_days == 12.0


def test_lead_time_clamps_to_zero_for_same_day_booking() -> None:
    row = row_from_raw({**BASE_ROW, "createdAt": "2026-06-01T10:00:00Z"})
    assert row.lead_time_days == 0.0


def test_weekend_flag_saturday() -> None:
    # 2026-06-06 is a Saturday (weekday() == 5)
    row = row_from_raw({**BASE_ROW, "date": "2026-06-06"})
    assert row.is_weekend == 1


def test_weekend_flag_sunday() -> None:
    # 2026-06-07 is a Sunday
    row = row_from_raw({**BASE_ROW, "date": "2026-06-07"})
    assert row.is_weekend == 1


def test_weekday_flag_monday() -> None:
    # 2026-06-01 is a Monday
    row = row_from_raw(BASE_ROW)
    assert row.is_weekend == 0
    assert row.day_of_week == 0  # Monday = 0 in Python


def test_prior_no_show_count_none_treated_as_zero() -> None:
    row = row_from_raw({**BASE_ROW, "priorNoShowCount": None})
    assert row.prior_no_show_count == 0.0


def test_prior_no_show_count_zero_by_default() -> None:
    raw = {k: v for k, v in BASE_ROW.items() if k != "priorNoShowCount"}
    row = row_from_raw(raw)
    assert row.prior_no_show_count == 0.0


def test_all_weather_false() -> None:
    row = row_from_raw({**BASE_ROW, "isAllWeather": False})
    assert row.is_all_weather == 0


def test_tenure_zero_for_new_user() -> None:
    # Member joined same day as play date
    row = row_from_raw({**BASE_ROW, "userCreatedAt": "2026-06-01T00:00:00Z"})
    assert row.tenure_days == 0.0


def test_tenure_positive_for_established_member() -> None:
    row = row_from_raw({**BASE_ROW, "userCreatedAt": "2025-01-01T00:00:00Z"})
    assert row.tenure_days > 0


def test_empty_rows_returns_empty_frame() -> None:
    frame = to_frame([])
    assert isinstance(frame, pd.DataFrame)
    assert len(frame) == 0
    assert "lead_time_days" in frame.columns


def test_multiple_rows_vectorise_correctly() -> None:
    rows = [
        BASE_ROW,
        {**BASE_ROW, "date": "2026-06-06", "isAllWeather": True},
    ]
    frame = to_frame(rows)
    assert frame.shape == (2, 8)
    assert frame.iloc[1]["is_weekend"] == 1
    assert frame.iloc[1]["is_all_weather"] == 1


def test_hour_parsing_early_morning() -> None:
    row = row_from_raw({**BASE_ROW, "timeSlot": "09:00"})
    assert row.hour_of_day == 9


def test_month_extracted_correctly() -> None:
    row = row_from_raw(BASE_ROW)
    assert row.month == 6  # June


def test_iso_date_string_accepted() -> None:
    # Full ISO-8601 date string should work (slice to 10 chars)
    row = row_from_raw({**BASE_ROW, "date": "2026-06-01T00:00:00Z"})
    assert row.month == 6

