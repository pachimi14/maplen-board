"""Tests for JST weekly/monthly gain period boundaries."""

from __future__ import annotations

from datetime import date

from ranking_periods import (
    monthly_period_start,
    sum_daily_gains_in_period,
    weekly_period_start,
)


def test_weekly_starts_on_thursday() -> None:
    assert weekly_period_start(date(2026, 6, 4)) == date(2026, 6, 4)  # Thu
    assert weekly_period_start(date(2026, 6, 5)) == date(2026, 6, 4)  # Fri
    assert weekly_period_start(date(2026, 6, 10)) == date(2026, 6, 4)  # Wed


def test_monthly_starts_on_first() -> None:
    assert monthly_period_start(date(2026, 6, 15)) == date(2026, 6, 1)


def test_sum_only_days_inside_period() -> None:
    rows = [
        ("2026-06-01", 10),
        ("2026-06-02", 20),
        ("2026-06-03", 30),
    ]
    assert (
        sum_daily_gains_in_period(
            rows,
            period_start=date(2026, 6, 2),
            period_end=date(2026, 6, 3),
        )
        == 50
    )


if __name__ == "__main__":
    test_weekly_starts_on_thursday()
    test_monthly_starts_on_first()
    test_sum_only_days_inside_period()
    print("ok")
