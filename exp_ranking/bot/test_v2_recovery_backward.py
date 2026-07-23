"""T12 P1: tests for the production backward-exact v2-shard recovery core
(v2_recovery_backward.py), used by
sqlite_storage.import_snapshots_from_v2_json.
"""

from __future__ import annotations

import random

from level_exp import (
    LEGACY_EXP_TO_NEXT_LEVEL_PRE_2026_07_23,
    LEVEL_CAP,
    TABLE_MIN_LEVEL,
    calculate_level_exp_percent,
    calculate_progress_toward_275,
    exp_required_for_level,
)
from v2_recovery_backward import (
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
    must be <= the true exp. This is the structural guarantee behind
    "never over-restores" for the production fallback path."""
    random.seed(7)
    for _ in range(5000):
        level = random.randint(TABLE_MIN_LEVEL, LEVEL_CAP - 1)
        required = exp_required_for_level(level)
        exp = random.randint(0, required - 1)
        percent = calculate_level_exp_percent(level, exp)
        conservative = exp_from_percent_conservative(level, percent)
        assert conservative <= exp, (level, exp, percent, conservative)


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
    )
    by_date = {r.snapshot_date: r for r in result}
    for d in dates:
        assert by_date[d].method == "exact"
        assert by_date[d].exp == exp_by_date[d]


def test_reconstruct_exp_backward_missing_daily_gain_breaks_chain_for_none_fallback() -> None:
    """fallback="none" (not used in production, kept for isolating the
    exact-or-nothing property in tests/analysis)."""
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
    # Once broken, "none" does not guess further back either.
    assert by_date["2026-01-01"].method == "unrecoverable"
    assert by_date["2026-01-01"].exp is None


def test_reconstruct_exp_backward_conservative_fallback_fills_every_day() -> None:
    """Production default (fallback="conservative"): never drops a day."""
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
    )
    assert all(r.exp is not None for r in result)
    by_date = {r.snapshot_date: r for r in result}
    assert by_date["2026-01-02"].method == "conservative_fallback"
    # Chain resumes (not exact, since it now hangs off an approximate 01-02)
    assert by_date["2026-01-01"].method == "conservative_fallback"


def test_reconstruct_exp_backward_conservative_fallback_never_exceeds_true_exp() -> None:
    """End-to-end version of the "never over-restore" guarantee: build a
    points_desc from real (level, exp) pairs (via calculate_level_exp_percent,
    exactly what mvp_export.py stores), force a break, and confirm the
    reconstructed exp never exceeds the true exp at the fallback point.
    """
    level = 240
    true_exp_day2 = 5_123_456_789
    percent_day2 = calculate_level_exp_percent(level, true_exp_day2)
    points_desc = [
        _point("2026-01-03", level, None, 10.0),
        _point("2026-01-02", level, None, percent_day2),
    ]
    result = reconstruct_exp_backward(
        anchor_date="2026-01-03", anchor_level=level, anchor_exp=1_000_000,
        points_desc=points_desc,
    )
    by_date = {r.snapshot_date: r for r in result}
    assert by_date["2026-01-02"].exp <= true_exp_day2


def test_reconstruct_exp_backward_duplicate_date_is_treated_as_untrustworthy() -> None:
    """Two rows for the same snapshotDate (a real production data-quality
    artifact, unrelated to T12) must not be silently chained through, even
    though a numeric dailyGain is present on both.
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
    )
    # Both duplicate-date entries get the (never-over) conservative fallback,
    # not a silently-wrong "exact" chained through the ambiguous dailyGain.
    dup_entries = [r for r in result if r.snapshot_date == "2026-06-03"]
    assert len(dup_entries) == 2
    assert all(r.method == "conservative_fallback" for r in dup_entries)


def test_reconstruct_exp_backward_empty_points() -> None:
    assert reconstruct_exp_backward(
        anchor_date="2026-01-01", anchor_level=240, anchor_exp=0,
        points_desc=[],
    ) == []


def _legacy_progress_toward_275(level: int, exp: int) -> int:
    total = sum(
        LEGACY_EXP_TO_NEXT_LEVEL_PRE_2026_07_23[lv]
        for lv in range(TABLE_MIN_LEVEL, LEVEL_CAP)
    )
    remaining = LEGACY_EXP_TO_NEXT_LEVEL_PRE_2026_07_23[level] - exp
    remaining += sum(
        LEGACY_EXP_TO_NEXT_LEVEL_PRE_2026_07_23[lv]
        for lv in range(level + 1, LEVEL_CAP)
    )
    return total - remaining


def test_reconstruct_exp_backward_uses_supplied_legacy_exp_table() -> None:
    level = 225
    exp_by_date = {
        "2026-07-21": 12_345_678_901,
        "2026-07-22": 45_678_901_234,
    }
    progress_by_date = {
        day: _legacy_progress_toward_275(level, exp)
        for day, exp in exp_by_date.items()
    }
    daily_gain = progress_by_date["2026-07-22"] - progress_by_date["2026-07-21"]
    points_desc = [
        _point("2026-07-22", level, daily_gain, 0.0),
        _point("2026-07-21", level, None, 0.0),
    ]

    result = reconstruct_exp_backward(
        anchor_date="2026-07-22",
        anchor_level=level,
        anchor_exp=exp_by_date["2026-07-22"],
        points_desc=points_desc,
        exp_table=LEGACY_EXP_TO_NEXT_LEVEL_PRE_2026_07_23,
    )

    by_date = {row.snapshot_date: row for row in result}
    assert by_date["2026-07-21"].method == "exact"
    assert by_date["2026-07-21"].exp == exp_by_date["2026-07-21"]
