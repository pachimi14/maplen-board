"""LULU-062: era-aware, non-clamped EXP primitives added to level_exp.py.

Covers `exp_table_for`, `calculate_progress_for_table`, and
`calculate_level_exp_percent_for_table`, plus a guard that the pre-existing
current-table-fixed functions (relied on by planner ETA / "latest day"
totals) are untouched.
"""

from __future__ import annotations

import random

import level_exp
from level_exp import (
    EXP_TABLE_CHANGE_BOUNDARY,
    EXP_TO_NEXT_LEVEL,
    LEGACY_EXP_TO_NEXT_LEVEL_PRE_2026_07_23,
    LEVEL_CAP,
    TABLE_MIN_LEVEL,
    calculate_level_exp_percent,
    calculate_level_exp_percent_for_table,
    calculate_progress_for_table,
    calculate_progress_toward_275,
    exp_table_for,
)


def test_exp_table_change_boundary_is_2026_07_23() -> None:
    assert EXP_TABLE_CHANGE_BOUNDARY == "2026-07-23"


def test_exp_table_for_boundary_selects_legacy_before_current_on_and_after() -> None:
    assert exp_table_for("2026-07-22") is LEGACY_EXP_TO_NEXT_LEVEL_PRE_2026_07_23
    assert exp_table_for("2026-07-23") is EXP_TO_NEXT_LEVEL
    assert exp_table_for("2026-01-01") is LEGACY_EXP_TO_NEXT_LEVEL_PRE_2026_07_23
    assert exp_table_for("2026-12-31") is EXP_TO_NEXT_LEVEL


def test_calculate_progress_for_table_same_level_telescopes_to_raw_exp_diff() -> None:
    """Core algebraic identity behind the fix: at a fixed level, P(T, level,
    exp2) - P(T, level, exp1) == exp2 - exp1, regardless of table and even
    when exp exceeds table[level] (overshoot -- no clamp)."""
    random.seed(11)
    for _ in range(2000):
        table = random.choice(
            [EXP_TO_NEXT_LEVEL, LEGACY_EXP_TO_NEXT_LEVEL_PRE_2026_07_23]
        )
        level = random.randint(TABLE_MIN_LEVEL, LEVEL_CAP - 1)
        exp1 = random.randint(0, 10 * table[level])
        exp2 = random.randint(0, 10 * table[level])
        diff = calculate_progress_for_table(
            level, exp2, table
        ) - calculate_progress_for_table(level, exp1, table)
        assert diff == exp2 - exp1


def test_calculate_progress_for_table_matches_clamped_version_when_no_overshoot() -> None:
    """When exp never exceeds the level's requirement, the new unclamped
    primitive (against the current table) must agree exactly with the
    pre-existing `calculate_progress_toward_275` -- the fix only changes
    behavior in the overshoot regime."""
    random.seed(23)
    for _ in range(2000):
        level = random.randint(TABLE_MIN_LEVEL, LEVEL_CAP - 1)
        required = EXP_TO_NEXT_LEVEL[level]
        exp = random.randint(0, required - 1)
        assert calculate_progress_for_table(
            level, exp, EXP_TO_NEXT_LEVEL
        ) == calculate_progress_toward_275(level, exp)


def test_calculate_progress_for_table_overshoot_is_not_clamped() -> None:
    level = 240
    required = EXP_TO_NEXT_LEVEL[level]
    overshoot_exp = required + 1_000_000

    clamped = calculate_progress_toward_275(level, overshoot_exp)
    unclamped = calculate_progress_for_table(level, overshoot_exp, EXP_TO_NEXT_LEVEL)

    # The clamped legacy function pins in-level exp at `required`; the new
    # primitive carries the full overshoot through.
    assert unclamped == clamped + 1_000_000


def test_calculate_progress_for_table_level_below_min_returns_exp_only() -> None:
    assert calculate_progress_for_table(TABLE_MIN_LEVEL, 500, EXP_TO_NEXT_LEVEL) == 500
    assert calculate_progress_for_table(TABLE_MIN_LEVEL - 5, 500, EXP_TO_NEXT_LEVEL) == 500


def test_calculate_level_exp_percent_for_table_matches_clamped_when_no_overshoot() -> None:
    random.seed(31)
    for _ in range(2000):
        level = random.randint(TABLE_MIN_LEVEL, LEVEL_CAP - 1)
        required = EXP_TO_NEXT_LEVEL[level]
        exp = random.randint(0, required - 1)
        assert calculate_level_exp_percent_for_table(
            level, exp, EXP_TO_NEXT_LEVEL
        ) == calculate_level_exp_percent(level, exp)


def test_calculate_level_exp_percent_for_table_overshoot_exceeds_100() -> None:
    level = 240
    required = EXP_TO_NEXT_LEVEL[level]
    overshoot_exp = int(required * 1.1)
    percent = calculate_level_exp_percent_for_table(level, overshoot_exp, EXP_TO_NEXT_LEVEL)
    assert percent > 100.0
    # Theoretical max overshoot ratio is 1 / 0.8 = 1.25 (the table shrank by
    # 20%); a same-level overshoot right at the old requirement caps there.
    assert percent <= 125.0 + 1e-6


def test_calculate_level_exp_percent_for_table_level_cap_is_100() -> None:
    assert calculate_level_exp_percent_for_table(LEVEL_CAP, 0, EXP_TO_NEXT_LEVEL) == 100.0


def test_calculate_level_exp_percent_for_table_missing_required_is_zero() -> None:
    sparse_table = {lv: value for lv, value in EXP_TO_NEXT_LEVEL.items() if lv != 240}
    assert calculate_level_exp_percent_for_table(240, 0, sparse_table) == 0.0


def test_existing_current_table_fixed_functions_are_unchanged() -> None:
    """Guard: this PR adds primitives but must not alter the pre-existing
    current-table-fixed functions (planner ETA / latest-day totals rely on
    them keeping their exact prior behavior)."""
    assert level_exp.calculate_level_exp_percent(240, 500_000_000) == round(
        500_000_000 / EXP_TO_NEXT_LEVEL[240] * 100.0, 3
    )
    # Clamp at 100 is still in force for the pre-existing function.
    assert level_exp.calculate_level_exp_percent(240, EXP_TO_NEXT_LEVEL[240] * 2) == 100.0
    assert level_exp.calculate_progress_toward_275(275, 0) == level_exp.TOTAL_EXP_225_TO_275
    assert level_exp.calculate_total_exp_from_240(240, 0) == 0
