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


def test_sum_does_not_treat_null_day_as_zero_gain() -> None:
    """A null day (unknown gain, e.g. a negative-gain artifact nulled out by
    analysis.py -- see docs/DECISION_LOG.md LULU-055) must be excluded from
    the sum entirely, not folded in as a real 0-gain day. Both have the same
    numeric effect on a plain sum (adding 0 changes nothing), so this test
    pins the *intended* semantics: the period total is the sum of the known
    days only, and a null day never contributes a synthetic 0 gain."""
    rows_with_null = [
        ("2026-06-01", 10),
        ("2026-06-02", None),
        ("2026-06-03", 30),
    ]
    total = sum_daily_gains_in_period(
        rows_with_null,
        period_start=date(2026, 6, 1),
        period_end=date(2026, 6, 3),
    )
    assert total == 40  # 10 + 30, 06-02 excluded (not counted as +0)


def test_partial_period_total_is_indistinguishable_from_complete_total() -> None:
    """Known limitation (reported as a finding, not fixed here): once a day's
    gain is unknown/null, `sum_daily_gains_in_period` has no way to signal
    that the returned total is partial. A period where one day is null (its
    true gain is unknown) currently produces the exact same total as a period
    where that day genuinely gained 0 -- callers cannot tell "verified
    complete sum" apart from "some days missing, sum understates the true
    total". If a "partial" indicator becomes necessary (e.g. to avoid
    weekly/monthly totals looking authoritative when they are not), it needs
    a dedicated flag/field -- out of scope for this commit (P-DQ negative-gain
    null-out only)."""
    rows_with_null_day = [
        ("2026-06-01", 10),
        ("2026-06-02", None),  # unknown -- could have been any non-negative value
        ("2026-06-03", 30),
    ]
    rows_with_genuine_zero_day = [
        ("2026-06-01", 10),
        ("2026-06-02", 0),  # verified: character truly gained nothing that day
        ("2026-06-03", 30),
    ]
    total_with_null = sum_daily_gains_in_period(
        rows_with_null_day, period_start=date(2026, 6, 1), period_end=date(2026, 6, 3)
    )
    total_with_zero = sum_daily_gains_in_period(
        rows_with_genuine_zero_day,
        period_start=date(2026, 6, 1),
        period_end=date(2026, 6, 3),
    )
    assert total_with_null == total_with_zero == 40


if __name__ == "__main__":
    test_weekly_starts_on_thursday()
    test_monthly_starts_on_first()
    test_sum_only_days_inside_period()
    test_sum_does_not_treat_null_day_as_zero_gain()
    test_partial_period_total_is_indistinguishable_from_complete_total()
    print("ok")
