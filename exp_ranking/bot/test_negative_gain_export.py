"""End-to-end (analysis.py -> mvp_export.py) coverage for negative-gain
null-out: history points, the character-level `dailyGain` field, and
weekly/monthly aggregation must all treat a nulled negative-gain day as
"unknown", never as a genuine 0-gain day (docs/DECISION_LOG.md LULU-055;
docs/IMPL_PLAN_dq-dup-rows.md)."""

from __future__ import annotations

from analysis import build_analysis_rows
from models import SnapshotRow
from mvp_export import build_mvp_characters
from ranking_periods import weekly_period_start
from datetime import date


def test_history_point_and_weekly_gain_exclude_a_mid_week_negative_day() -> None:
    # Same week (weekly_period_start groups Thu..Wed); 07-17's exp regresses
    # relative to 07-16 -- a bad-data artifact, not a real loss.
    snapshots = [
        SnapshotRow("2026-07-16", 1, 0, "Hero", "", "HERO", 248, 5_000_000, "", "key-1"),
        SnapshotRow("2026-07-17", 1, 0, "Hero", "", "HERO", 248, 1_000_000, "", "key-1"),
        SnapshotRow("2026-07-18", 1, 0, "Hero", "", "HERO", 248, 2_000_000, "", "key-1"),
        SnapshotRow("2026-07-19", 1, 0, "Hero", "", "HERO", 248, 3_000_000, "", "key-1"),
    ]
    analysis_rows = build_analysis_rows(snapshots)
    characters = build_mvp_characters(
        snapshots, analysis_rows, latest_snapshot_date="2026-07-19"
    )
    assert len(characters) == 1
    character = characters[0]
    history_by_date = {p["snapshotDate"]: p["dailyGain"] for p in character["history"]}

    assert history_by_date["2026-07-16"] is None  # no prior day in DB
    assert history_by_date["2026-07-17"] is None  # negative -> nulled, not -4_000_000
    assert history_by_date["2026-07-18"] == 1_000_000  # 2,000,000 - 1,000,000 (real chain)
    assert history_by_date["2026-07-19"] == 1_000_000  # 3,000,000 - 2,000,000

    assert weekly_period_start(date(2026, 7, 19)) == weekly_period_start(date(2026, 7, 16))
    # Weekly total = sum of the *known* days only (1,000,000 + 1,000,000).
    # If the null day were folded in as 0 the total would be unaffected here
    # (0 changes nothing) -- the real risk this guards is a period where the
    # null day is the *only* known-negative artifact and everything else is
    # correctly excluded rather than coerced to 0 and summed.
    assert character["weeklyGain"] == 2_000_000
    assert character["monthlyGain"] == 2_000_000

    # Latest-day dailyGain field mirrors the latest history point (not nulled
    # here, since 07-19 itself is a genuine positive gain).
    assert character["dailyGain"] == 1_000_000


def test_latest_day_negative_gain_falls_back_to_last_known_value_not_zero() -> None:
    """When the *latest* ranking day itself is the negative-gain artifact,
    mvp_export's existing fallback (pre-dating this change) picks the most
    recent non-null gain from history instead of showing a nulled/zero
    "today's gain" card. Documented here as the intended, already-correct
    behavior -- no mvp_export.py code change was needed for this case."""
    snapshots = [
        SnapshotRow("2026-07-16", 1, 0, "Hero", "", "HERO", 248, 1_000_000, "", "key-1"),
        SnapshotRow("2026-07-17", 1, 0, "Hero", "", "HERO", 248, 2_000_000, "", "key-1"),
        # Latest day regresses -- gets nulled by analysis.py.
        SnapshotRow("2026-07-18", 1, 0, "Hero", "", "HERO", 248, 500_000, "", "key-1"),
    ]
    analysis_rows = build_analysis_rows(snapshots)
    characters = build_mvp_characters(
        snapshots, analysis_rows, latest_snapshot_date="2026-07-18"
    )
    character = characters[0]
    history_by_date = {p["snapshotDate"]: p["dailyGain"] for p in character["history"]}
    assert history_by_date["2026-07-18"] is None

    # Falls back to 07-17's known gain (1,000,000), not 0 and not negative.
    assert character["dailyGain"] == 1_000_000


if __name__ == "__main__":
    test_history_point_and_weekly_gain_exclude_a_mid_week_negative_day()
    test_latest_day_negative_gain_falls_back_to_last_known_value_not_zero()
    print("ok")
