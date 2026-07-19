"""T12 P1 follow-up: tests for the candidate backward-exact reconstruction
(v2_recovery_backward.py). This module is NOT wired into main.py/config.py --
these tests establish the correctness properties the coordinator asked to be
verified before any decision between method B / C / D (and shipped method A)
is made.
"""

from __future__ import annotations

import random

import pytest

from level_exp import LEVEL_CAP, TABLE_MIN_LEVEL, calculate_progress_toward_275, exp_required_for_level
from v2_recovery_backward import (
    ReconstructedDay,
    exp_from_percent,
    exp_from_percent_conservative,
    exp_from_progress,
    reconstruct_exp_backward,
)


def test_exp_from_progress_round_trips_exactly() -> None:
    random.seed(42)
    for _ in range(3000):
        level = random.randint(TABLE_MIN_LEVEL, LEVEL_CAP - 1)
        required = exp_required_for_level(level)
        exp = random.randint(0, required - 1)
        progress = calculate_progress_toward_275(level, exp)
        assert exp_from_progress(level, progress) == exp


def test_exp_from_progress_rejects_out_of_range_level() -> None:
    assert exp_from_progress(TABLE_MIN_LEVEL - 1, 0) is None
    assert exp_from_progress(LEVEL_CAP, 0) is None


def test_exp_from_percent_conservative_never_exceeds_true_exp() -> None:
    """Property: for any level/exp, round(percent,3) -> conservative-invert
    must be <= the true exp (the whole point of method D)."""
    random.seed(7)
    for _ in range(5000):
        level = random.randint(TABLE_MIN_LEVEL, LEVEL_CAP - 1)
        required = exp_required_for_level(level)
        exp = random.randint(0, required - 1)
        from level_exp import calculate_level_exp_percent

        percent = calculate_level_exp_percent(level, exp)
        conservative = exp_from_percent_conservative(level, percent)
        assert conservative <= exp, (level, exp, percent, conservative)


def test_exp_from_percent_can_exceed_true_exp() -> None:
    """Documents the known defect in the naive (method A / B-fallback)
    inversion: it CAN land above the true exp, unlike the conservative one."""
    random.seed(7)
    overshoots = 0
    for _ in range(5000):
        level = random.randint(TABLE_MIN_LEVEL, LEVEL_CAP - 1)
        required = exp_required_for_level(level)
        exp = random.randint(0, required - 1)
        from level_exp import calculate_level_exp_percent

        percent = calculate_level_exp_percent(level, exp)
        naive = exp_from_percent(level, percent)
        if naive > exp:
            overshoots += 1
    assert overshoots > 0


def _point(date: str, level: int, daily_gain: int | None, percent: float) -> dict:
    return {
        "snapshotDate": date,
        "level": level,
        "dailyGain": daily_gain,
        "levelExpPercent": percent,
        "expPercent": percent,
    }


def test_reconstruct_exp_backward_clean_chain_is_exact() -> None:
    """No gaps, no duplicates: every day should resolve "exact"."""
    level = 240
    exp_by_date = {
        "2026-01-01": 10_000_000_000,
        "2026-01-02": 30_000_000_000,
        "2026-01-03": 55_000_000_000,
    }
    progress_by_date = {d: calculate_progress_toward_275(level, e) for d, e in exp_by_date.items()}
    dates = sorted(exp_by_date)
    daily_gain_by_date = {dates[0]: None}
    for prev, cur in zip(dates, dates[1:]):
        daily_gain_by_date[cur] = progress_by_date[cur] - progress_by_date[prev]

    points_desc = [
        _point(d, level, daily_gain_by_date[d], 0.0) for d in reversed(dates)
    ]
    result = reconstruct_exp_backward(
        anchor_date=dates[-1],
        anchor_level=level,
        anchor_exp=exp_by_date[dates[-1]],
        points_desc=points_desc,
        fallback="none",
    )
    by_date = {r.snapshot_date: r for r in result}
    for d in dates:
        assert by_date[d].method == "exact"
        assert by_date[d].exp == exp_by_date[d]


def test_reconstruct_exp_backward_missing_daily_gain_breaks_chain_for_none_fallback() -> None:
    level = 240
    points_desc = [
        _point("2026-01-03", level, None, 10.0),  # anchor's own dailyGain unused
        _point("2026-01-02", level, None, 5.0),  # missing dailyGain -> break
        _point("2026-01-01", level, 12345, 2.0),  # would need progress from 01-02, now lost
    ]
    result = reconstruct_exp_backward(
        anchor_date="2026-01-03",
        anchor_level=level,
        anchor_exp=1_000_000,
        points_desc=points_desc,
        fallback="none",
    )
    by_date = {r.snapshot_date: r for r in result}
    assert by_date["2026-01-03"].method == "exact"
    assert by_date["2026-01-02"].method == "unrecoverable"
    assert by_date["2026-01-02"].exp is None
    # Once broken, method C does not guess further back either.
    assert by_date["2026-01-01"].method == "unrecoverable"
    assert by_date["2026-01-01"].exp is None


def test_reconstruct_exp_backward_percent_fallback_fills_every_day() -> None:
    level = 240
    points_desc = [
        _point("2026-01-03", level, None, 10.0),
        _point("2026-01-02", level, None, 5.0),
        _point("2026-01-01", level, 12345, 2.0),
    ]
    result = reconstruct_exp_backward(
        anchor_date="2026-01-03",
        anchor_level=level,
        anchor_exp=1_000_000,
        points_desc=points_desc,
        fallback="percent",
    )
    assert all(r.exp is not None for r in result)
    by_date = {r.snapshot_date: r for r in result}
    assert by_date["2026-01-02"].method == "percent_fallback"
    # Chain resumes (not exact, since it now hangs off an approximate 01-02)
    assert by_date["2026-01-01"].method == "percent_fallback"


def test_reconstruct_exp_backward_duplicate_date_is_treated_as_untrustworthy() -> None:
    """Two rows for the same snapshotDate (a real production data-quality
    artifact -- see the T12 P1 follow-up report) must not be silently
    chained through, even though a numeric dailyGain is present on both.
    """
    level = 225
    points_desc = [
        _point("2026-06-04", level, 0, 2.55),  # anchor's own point (date must match anchor_date)
        _point("2026-06-03", level, -358669, 2.55),  # duplicate #1 (rank 5629 in prod)
        _point("2026-06-03", level, -358669, 0.57),  # duplicate #2 (rank 5615 in prod)
        _point("2026-06-01", level, None, 0.57),
    ]
    result = reconstruct_exp_backward(
        anchor_date="2026-06-04",
        anchor_level=level,
        anchor_exp=8_019_596_009,
        points_desc=points_desc,
        fallback="none",
    )
    # Both duplicate-date entries must be marked unrecoverable, not "exact".
    dup_entries = [r for r in result if r.snapshot_date == "2026-06-03"]
    assert len(dup_entries) == 2
    assert all(r.method == "unrecoverable" for r in dup_entries)


def test_reconstruct_exp_backward_conservative_fallback_never_exceeds_naive() -> None:
    level = 240
    points_desc = [
        _point("2026-01-03", level, None, 10.0),
        _point("2026-01-02", level, None, 5.123),
    ]
    naive = reconstruct_exp_backward(
        anchor_date="2026-01-03", anchor_level=level, anchor_exp=1_000_000,
        points_desc=points_desc, fallback="percent",
    )
    conservative = reconstruct_exp_backward(
        anchor_date="2026-01-03", anchor_level=level, anchor_exp=1_000_000,
        points_desc=points_desc, fallback="conservative",
    )
    naive_by_date = {r.snapshot_date: r.exp for r in naive}
    conservative_by_date = {r.snapshot_date: r.exp for r in conservative}
    assert conservative_by_date["2026-01-02"] <= naive_by_date["2026-01-02"]


def test_reconstruct_exp_backward_empty_points() -> None:
    assert reconstruct_exp_backward(
        anchor_date="2026-01-01", anchor_level=240, anchor_exp=0,
        points_desc=[], fallback="none",
    ) == []
