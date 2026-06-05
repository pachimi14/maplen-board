"""Tests for UTC gain-day id (snapshot_date)."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from ranking_day import ranking_day_from_fetch

UTC = ZoneInfo("UTC")


def test_utc_jun5_midnight_is_jun4_gain_day() -> None:
    dt = datetime(2026, 6, 5, 0, 0, tzinfo=UTC)
    assert ranking_day_from_fetch(dt) == "2026-06-04"


def test_utc_jun5_0020_is_still_jun4_gain_day() -> None:
    dt = datetime(2026, 6, 5, 0, 20, tzinfo=UTC)
    assert ranking_day_from_fetch(dt) == "2026-06-04"


def test_utc_jun5_afternoon_is_jun4_gain_day() -> None:
    dt = datetime(2026, 6, 5, 15, 0, tzinfo=UTC)
    assert ranking_day_from_fetch(dt) == "2026-06-04"


def test_utc_jun6_midnight_is_jun5_gain_day() -> None:
    dt = datetime(2026, 6, 6, 0, 0, tzinfo=UTC)
    assert ranking_day_from_fetch(dt) == "2026-06-05"


if __name__ == "__main__":
    test_utc_jun5_midnight_is_jun4_gain_day()
    test_utc_jun5_0020_is_still_jun4_gain_day()
    test_utc_jun5_afternoon_is_jun4_gain_day()
    test_utc_jun6_midnight_is_jun5_gain_day()
    print("ok")
