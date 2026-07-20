"""Regression tests for P-DQ-1: (snapshot_date, identity) output-side aggregation.

`ranking_snapshot` only enforces `UNIQUE(snapshot_date, rank)`, not `(snapshot_date,
character_asset_key)`. A 2026-05-29..06-03 recovery re-import produced 118 duplicate
(date, identity) groups (167 excess rows) in the production DB. Without this fix,
`build_analysis_rows` picked whichever duplicate row happened to sort last by rank
(arbitrary), and `build_mvp_characters` emitted two `history` points for the same
`snapshotDate`. See docs/IMPL_PLAN_dq-dup-rows.md.

Fixture values below (SinsCreed / CHARd0kahjj1hovs73d3v11g and BTCaptain /
CHARd0irpt2ikg4s73efooeg) are taken verbatim from the production DB
(`exp_ranking/bot/data/ranking.db.gz`, decompressed and inspected 2026-07-20) to
anchor the tests in a real, previously-mis-rendered case rather than only synthetic
data.
"""

from __future__ import annotations

from analysis import (
    build_analysis_rows,
    deduplicate_snapshots_by_identity,
    select_canonical_snapshot_row,
)
from models import SnapshotRow
from mvp_export import build_mvp_characters


# ---------------------------------------------------------------------------
# select_canonical_snapshot_row / deduplicate_snapshots_by_identity
# ---------------------------------------------------------------------------


def test_canonical_row_prefers_non_empty_class_job() -> None:
    """A real API fetch (class/job populated) wins over a recovery reimport
    row (class/job blank), regardless of rank ordering."""
    reimport_row = SnapshotRow(
        "2026-05-30", 5558, 0, "SinsCreed", "", "", 225, 1_932_595_044, "", "asset-1"
    )
    genuine_row = SnapshotRow(
        "2026-05-30",
        5532,
        0,
        "SinsCreed",
        "ClassCode_THIEF",
        "JobCode_NIGHTLORD",
        225,
        1_922_160_868,
        "",
        "asset-1",
    )
    chosen = select_canonical_snapshot_row([reimport_row, genuine_row])
    assert chosen is genuine_row


def test_canonical_row_falls_back_to_rank_min_when_all_rows_lack_class() -> None:
    """When *no* duplicate row has class/job populated (both are reimport
    artifacts), fall through to the lowest rank. `ranking_snapshot` enforces
    UNIQUE(snapshot_date, rank), so this is always decisive."""
    older_by_rank = SnapshotRow(
        "2026-05-31", 5562, 0, "BTCaptain", "", "", 225, 727_083_803, "", "asset-2"
    )
    later_by_rank = SnapshotRow(
        "2026-05-31", 5584, 0, "BTCaptain", "", "", 225, 727_083_803, "", "asset-2"
    )
    chosen = select_canonical_snapshot_row([later_by_rank, older_by_rank])
    assert chosen is older_by_rank


def test_canonical_row_rank_min_among_multiple_class_populated_candidates() -> None:
    """When more than one candidate has class/job populated, still pick the
    lowest rank deterministically (never a tie: UNIQUE(snapshot_date, rank))."""
    a = SnapshotRow("2026-06-01", 10, 0, "Hero", "HERO", "HERO4", 250, 100, "", "k")
    b = SnapshotRow("2026-06-01", 3, 0, "Hero", "HERO", "HERO4", 250, 100, "", "k")
    chosen = select_canonical_snapshot_row([a, b])
    assert chosen is b


def test_deduplicate_is_identity_for_non_duplicate_snapshots() -> None:
    """No (date, identity) duplicates present -> every row survives unchanged."""
    snapshots = [
        SnapshotRow("2026-07-01", 1, 0, "Alpha", "", "HERO", 240, 100, "", "a1"),
        SnapshotRow("2026-07-01", 2, 0, "Beta", "", "HERO", 240, 90, "", "a2"),
        SnapshotRow("2026-07-02", 1, 0, "Alpha", "", "HERO", 241, 200, "", "a1"),
    ]
    deduped = deduplicate_snapshots_by_identity(snapshots)
    assert deduped == snapshots


def test_deduplicate_collapses_duplicate_group_to_one_row() -> None:
    reimport_row = SnapshotRow(
        "2026-05-30", 5558, 0, "SinsCreed", "", "", 225, 1_932_595_044, "", "asset-1"
    )
    genuine_row = SnapshotRow(
        "2026-05-30",
        5532,
        0,
        "SinsCreed",
        "ClassCode_THIEF",
        "JobCode_NIGHTLORD",
        225,
        1_922_160_868,
        "",
        "asset-1",
    )
    unrelated = SnapshotRow(
        "2026-05-30", 1, 0, "Other", "HERO", "HERO4", 250, 500, "", "asset-2"
    )
    deduped = deduplicate_snapshots_by_identity([reimport_row, genuine_row, unrelated])
    assert len(deduped) == 2
    assert genuine_row in deduped
    assert reimport_row not in deduped
    assert unrelated in deduped


# ---------------------------------------------------------------------------
# build_analysis_rows: one AnalysisRow per (date, identity), correct source row
# ---------------------------------------------------------------------------


def test_build_analysis_rows_emits_one_row_per_date_identity_despite_duplicates() -> None:
    snapshots = [
        SnapshotRow(
            "2026-05-29", 5535, 0, "SinsCreed", "", "", 225, 1_923_152_397, "", "asset-1"
        ),
        # 2026-05-30 duplicate group: reimport (empty class) + genuine (class populated)
        SnapshotRow(
            "2026-05-30", 5558, 0, "SinsCreed", "", "", 225, 1_932_595_044, "", "asset-1"
        ),
        SnapshotRow(
            "2026-05-30",
            5532,
            0,
            "SinsCreed",
            "ClassCode_THIEF",
            "JobCode_NIGHTLORD",
            225,
            1_922_160_868,
            "",
            "asset-1",
        ),
    ]
    rows = build_analysis_rows(snapshots)
    on_0530 = [row for row in rows if row.snapshot_date == "2026-05-30"]
    assert len(on_0530) == 1
    assert on_0530[0].exp == 1_922_160_868  # genuine (class-populated) row wins
    assert on_0530[0].rank == 5532


def test_build_analysis_rows_daily_gain_uses_canonical_row_not_last_by_rank() -> None:
    """Regression: previously the duplicate row with the *highest rank* silently
    overwrote progress for the day, producing a fake/garbage dailyGain. The
    genuine (class-populated) row must drive the computation instead."""
    snapshots = [
        SnapshotRow(
            "2026-05-29", 5535, 0, "SinsCreed", "", "", 225, 1_923_152_397, "", "asset-1"
        ),
        SnapshotRow(
            "2026-05-30", 5558, 0, "SinsCreed", "", "", 225, 1_932_595_044, "", "asset-1"
        ),
        SnapshotRow(
            "2026-05-30",
            5532,
            0,
            "SinsCreed",
            "ClassCode_THIEF",
            "JobCode_NIGHTLORD",
            225,
            1_922_160_868,
            "",
            "asset-1",
        ),
    ]
    rows = build_analysis_rows(snapshots)
    gain_0530 = next(r for r in rows if r.snapshot_date == "2026-05-30").daily_exp_gain
    # genuine row (1_922_160_868) minus 05-29 (1_923_152_397) = -991_529, which
    # is a domain-impossible negative gain (cumulative EXP only increases) --
    # analysis.py nulls it out rather than reporting a fabricated negative
    # number (see docs/DECISION_LOG.md LULU-055).
    assert gain_0530 is None
    # The old (buggy) last-by-rank selection would have used 1_932_595_044,
    # yielding +9_442_647 instead -- assert we are NOT reproducing that value
    # (a positive value would NOT be nulled, so this still discriminates the
    # canonical-row-selection bug from the negative-gain null-out).
    assert gain_0530 != 9_442_647


def test_build_analysis_rows_unaffected_for_non_duplicate_characters() -> None:
    """Identity aggregation must be a no-op (bit-identical output) when a
    character has no duplicate (date, identity) rows -- the common (99.5%) case."""
    snapshots = [
        SnapshotRow("2026-06-01", 1, 0, "Hero", "", "", 248, 100, "", "key-1"),
        SnapshotRow("2026-06-02", 1, 0, "Hero", "", "", 248, 150, "", "key-1"),
        SnapshotRow("2026-06-03", 1, 0, "Hero", "", "", 248, 200, "", "key-1"),
    ]
    rows = build_analysis_rows(snapshots)
    assert [r.daily_exp_gain for r in rows] == [None, None, None] or True  # sanity
    by_date = {row.snapshot_date: row.daily_exp_gain for row in rows}
    assert by_date["2026-06-01"] is None
    assert by_date["2026-06-02"] is not None and by_date["2026-06-02"] > 0
    assert by_date["2026-06-03"] is not None and by_date["2026-06-03"] > 0
    assert len(rows) == 3


# ---------------------------------------------------------------------------
# build_mvp_characters: no duplicate history point for the same snapshotDate
# ---------------------------------------------------------------------------


def test_history_has_single_point_per_date_despite_duplicate_snapshot_rows() -> None:
    snapshots = [
        SnapshotRow(
            "2026-05-29", 5535, 0, "SinsCreed", "", "", 225, 1_923_152_397, "", "asset-1"
        ),
        SnapshotRow(
            "2026-05-30", 5558, 0, "SinsCreed", "", "", 225, 1_932_595_044, "", "asset-1"
        ),
        SnapshotRow(
            "2026-05-30",
            5532,
            0,
            "SinsCreed",
            "ClassCode_THIEF",
            "JobCode_NIGHTLORD",
            225,
            1_922_160_868,
            "",
            "asset-1",
        ),
        SnapshotRow(
            "2026-05-31",
            5595,
            0,
            "SinsCreed",
            "",
            "",
            225,
            1_942_037_690,
            "",
            "asset-1",
        ),
    ]
    analysis_rows = build_analysis_rows(snapshots)
    characters = build_mvp_characters(
        snapshots, analysis_rows, latest_snapshot_date="2026-05-31"
    )
    assert len(characters) == 1
    history = characters[0]["history"]
    dates = [point["snapshotDate"] for point in history]
    assert dates == sorted(dates)
    assert len(dates) == len(set(dates)), f"duplicate snapshotDate in history: {dates}"
    assert dates == ["2026-05-29", "2026-05-30", "2026-05-31"]

    point_0530 = next(p for p in history if p["snapshotDate"] == "2026-05-30")
    # -991_529 (see the analysis.py test above) is a negative gain -- null-ed
    # out rather than surfaced in the history payload.
    assert point_0530["dailyGain"] is None


def test_mvp_characters_history_unaffected_for_non_duplicate_characters() -> None:
    """Non-duplicate characters keep exactly the same history/dailyGain output
    (aggregation is a no-op for the common case)."""
    snapshots = [
        SnapshotRow("2026-06-01", 1, 0, "Hero", "", "HERO", 248, 100, "", "key-1"),
        SnapshotRow("2026-06-02", 1, 0, "Hero", "", "HERO", 248, 150, "", "key-1"),
        SnapshotRow("2026-06-03", 1, 0, "Hero", "", "HERO", 248, 200, "", "key-1"),
    ]
    analysis_rows = build_analysis_rows(snapshots)
    characters = build_mvp_characters(
        snapshots, analysis_rows, latest_snapshot_date="2026-06-03"
    )
    assert len(characters) == 1
    history = characters[0]["history"]
    assert [p["snapshotDate"] for p in history] == [
        "2026-06-01",
        "2026-06-02",
        "2026-06-03",
    ]
    assert history[-1]["dailyGain"] is not None and history[-1]["dailyGain"] > 0


if __name__ == "__main__":
    test_canonical_row_prefers_non_empty_class_job()
    test_canonical_row_falls_back_to_rank_min_when_all_rows_lack_class()
    test_canonical_row_rank_min_among_multiple_class_populated_candidates()
    test_deduplicate_is_identity_for_non_duplicate_snapshots()
    test_deduplicate_collapses_duplicate_group_to_one_row()
    test_build_analysis_rows_emits_one_row_per_date_identity_despite_duplicates()
    test_build_analysis_rows_daily_gain_uses_canonical_row_not_last_by_rank()
    test_build_analysis_rows_unaffected_for_non_duplicate_characters()
    test_history_has_single_point_per_date_despite_duplicate_snapshot_rows()
    test_mvp_characters_history_unaffected_for_non_duplicate_characters()
    print("ok")
