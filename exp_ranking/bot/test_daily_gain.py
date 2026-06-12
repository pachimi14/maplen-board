"""Regression: daily gain must not sum across missing ranking days in DB."""

from __future__ import annotations

from models import SnapshotRow
from analysis import build_analysis_rows


def test_daily_gain_none_when_previous_ranking_day_missing_in_db() -> None:
    snapshots = [
        SnapshotRow("2026-06-01", 1, 0, "Hero", "", "", 248, 100, "", "key-1"),
        SnapshotRow("2026-06-03", 1, 0, "Hero", "", "", 248, 200, "", "key-1"),
    ]
    rows = build_analysis_rows(snapshots)
    by_date = {row.snapshot_date: row.daily_exp_gain for row in rows}
    assert by_date["2026-06-01"] is None
    assert by_date["2026-06-03"] is None


def test_daily_gain_uses_calendar_previous_day_when_present() -> None:
    snapshots = [
        SnapshotRow("2026-06-01", 1, 0, "Hero", "", "", 248, 100, "", "key-1"),
        SnapshotRow("2026-06-02", 1, 0, "Hero", "", "", 248, 150, "", "key-1"),
        SnapshotRow("2026-06-03", 1, 0, "Hero", "", "", 248, 200, "", "key-1"),
    ]
    rows = build_analysis_rows(snapshots)
    by_date = {row.snapshot_date: row.daily_exp_gain for row in rows}
    assert by_date["2026-06-01"] is None
    assert by_date["2026-06-02"] is not None and by_date["2026-06-02"] > 0
    assert by_date["2026-06-03"] is not None and by_date["2026-06-03"] > 0


def test_daily_gain_at_level_250_counts_exp_past_milestone() -> None:
    snapshots = [
        SnapshotRow("2026-06-11", 1, 0, "Hero", "", "", 250, 1_000_000_000, "", "key-1"),
        SnapshotRow("2026-06-12", 1, 0, "Hero", "", "", 250, 2_000_000_000, "", "key-1"),
    ]
    rows = build_analysis_rows(snapshots)
    by_date = {row.snapshot_date: row.daily_exp_gain for row in rows}
    assert by_date["2026-06-12"] == 1_000_000_000


def test_daily_gain_level_up_into_250() -> None:
    from level_exp import EXP_TO_NEXT_LEVEL

    required_249 = EXP_TO_NEXT_LEVEL[249]
    snapshots = [
        SnapshotRow(
            "2026-06-11", 1, 0, "Hero", "", "", 249, required_249 - 1_000_000, "", "key-1"
        ),
        SnapshotRow("2026-06-12", 1, 0, "Hero", "", "", 250, 500_000_000, "", "key-1"),
    ]
    rows = build_analysis_rows(snapshots)
    gain = {row.snapshot_date: row.daily_exp_gain for row in rows}["2026-06-12"]
    assert gain is not None and gain > 0


if __name__ == "__main__":
    test_daily_gain_none_when_previous_ranking_day_missing_in_db()
    test_daily_gain_uses_calendar_previous_day_when_present()
    test_daily_gain_at_level_250_counts_exp_past_milestone()
    test_daily_gain_level_up_into_250()
    print("ok")
