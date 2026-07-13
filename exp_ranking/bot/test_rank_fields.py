"""Fixture-driven tests for T1 rank-derived fields.

Covers `docs/IMPL_PLAN_T1.md` §4 acceptance tests. All fixtures are
hand-built (no dependency on external API data or the live database) per
PR-004.

This first slice covers rankFluctuation (passthrough) and previousRank
(1-calendar-day lookback via existing identity resolution). jobRank/
worldRank fixtures land in a follow-up commit.
"""

from __future__ import annotations

import copy

from mvp_export import build_mvp_characters, build_mvp_payload, build_v2_payloads
from models import SnapshotRow


def test_rank_fluctuation_is_passed_through_verbatim() -> None:
    """#7: rankFluctuation is the raw API value, never recomputed."""
    snapshots = [
        # rank_fluctuation deliberately does NOT match (previousRank - rank)
        # to prove it is a straight passthrough, not a derived value.
        SnapshotRow("2026-07-02", 1, 42, "Alpha", "", "HERO", 250, 100, "", "a1"),
        SnapshotRow("2026-07-02", 2, -7, "Beta", "", "HERO", 240, 50, "", "a2"),
        SnapshotRow("2026-07-02", 3, 0, "Gamma", "", "HERO", 230, 10, "", "a3"),
    ]
    characters = build_mvp_characters(
        snapshots, [], latest_snapshot_date="2026-07-02"
    )
    by_name = {c["name"]: c for c in characters}
    assert by_name["Alpha"]["rankFluctuation"] == 42
    assert by_name["Beta"]["rankFluctuation"] == -7
    assert by_name["Gamma"]["rankFluctuation"] == 0


def test_previous_rank_null_when_previous_day_snapshot_absent_entirely() -> None:
    """#4: no snapshot for latest_date-1 anywhere -> previousRank=null for all."""
    snapshots = [
        SnapshotRow("2026-07-02", 1, 0, "Alpha", "", "HERO", 250, 100, "", "a1"),
        SnapshotRow("2026-07-02", 2, 0, "Beta", "", "HERO", 240, 50, "", "a2"),
    ]
    characters = build_mvp_characters(
        snapshots, [], latest_snapshot_date="2026-07-02"
    )
    assert all(c["previousRank"] is None for c in characters)


def test_previous_rank_null_only_for_character_missing_on_previous_day() -> None:
    """#5: previous day snapshot exists, but only for some characters."""
    snapshots = [
        SnapshotRow("2026-07-01", 1, 0, "Alpha", "", "HERO", 240, 100, "", "a1"),
        SnapshotRow("2026-07-01", 2, 0, "Beta", "", "HERO", 235, 90, "", "a2"),
        SnapshotRow("2026-07-02", 2, 1, "Alpha", "", "HERO", 250, 200, "", "a1"),
        SnapshotRow("2026-07-02", 3, -1, "Beta", "", "HERO", 240, 150, "", "a2"),
        # Gamma is new: no row on 2026-07-01.
        SnapshotRow("2026-07-02", 1, 0, "Gamma", "", "HERO", 260, 300, "", "a3"),
    ]
    characters = build_mvp_characters(
        snapshots, [], latest_snapshot_date="2026-07-02"
    )
    by_name = {c["name"]: c for c in characters}
    assert by_name["Alpha"]["previousRank"] == 1
    assert by_name["Beta"]["previousRank"] == 2
    assert by_name["Gamma"]["previousRank"] is None


def test_previous_rank_does_not_fall_back_to_latest_successful_day() -> None:
    """previousRank looks back exactly 1 calendar day; it does not skip to
    the nearest earlier available snapshot when latest_date-1 is missing
    (e.g. a fetch was skipped that day)."""
    snapshots = [
        # 2026-06-30 exists, but 2026-07-01 (latest-1) is missing (skipped).
        SnapshotRow("2026-06-30", 1, 0, "Alpha", "", "HERO", 200, 10, "", "a1"),
        SnapshotRow("2026-07-02", 1, 0, "Alpha", "", "HERO", 250, 200, "", "a1"),
    ]
    characters = build_mvp_characters(
        snapshots, [], latest_snapshot_date="2026-07-02"
    )
    assert characters[0]["previousRank"] is None


def test_previous_rank_survives_rename_via_asset_key() -> None:
    """#6: identity resolution follows asset key, so a rename between the
    previous day and the latest day still matches for previousRank."""
    snapshots = [
        SnapshotRow("2026-07-01", 5, 0, "OldName", "", "HERO", 240, 100, "", "ax"),
        SnapshotRow("2026-07-02", 2, 3, "NewName", "", "HERO", 250, 300, "", "ax"),
    ]
    characters = build_mvp_characters(
        snapshots, [], latest_snapshot_date="2026-07-02"
    )
    assert characters[0]["name"] == "NewName"
    assert characters[0]["previousRank"] == 5


def test_build_mvp_characters_does_not_mutate_input_snapshots() -> None:
    """#9: output fields are additive; the input snapshot rows are untouched."""
    snapshots = [
        SnapshotRow("2026-07-01", 2, 0, "Alpha", "", "HERO", 240, 100, "", "a1"),
        SnapshotRow("2026-07-02", 1, 4, "Alpha", "", "HERO", 250, 300, "", "a1"),
        SnapshotRow("2026-07-02", 2, -2, "Beta", "", "PALADIN", 245, 200, "", "a2"),
    ]
    before = copy.deepcopy(snapshots)
    build_mvp_characters(snapshots, [], latest_snapshot_date="2026-07-02")
    assert snapshots == before


def test_existing_fields_unchanged_in_v1_and_v2_payloads() -> None:
    """#10: pre-existing keys keep their values/types in both v1 (build_mvp_payload)
    and v2 (build_v2_payloads) shapes, across rising/falling/flat rank and
    null-previousRank scenarios."""
    snapshots = [
        SnapshotRow("2026-07-01", 2, 0, "Alpha", "", "HERO", 240, 100, "", "a1"),
        SnapshotRow("2026-07-01", 1, 0, "Beta", "", "PALADIN", 245, 150, "", "a2"),
        SnapshotRow("2026-07-02", 1, 1, "Alpha", "", "HERO", 250, 300, "", "a1"),  # rose
        SnapshotRow("2026-07-02", 2, -1, "Beta", "", "PALADIN", 246, 160, "", "a2"),  # fell
        SnapshotRow("2026-07-02", 3, 0, "Gamma", "", "HERO", 230, 50, "", "a3"),  # new/flat
    ]
    payload = build_mvp_payload(
        snapshots,
        [],
        latest_snapshot_date="2026-07-02",
        character_meta={"a1": "Ain", "a2": "Ain"},
    )
    v1_characters = payload["characters"]
    by_name_v1 = {c["name"]: c for c in v1_characters}

    # Pre-existing fields: value/type spot checks.
    assert by_name_v1["Alpha"]["rank"] == 1 and isinstance(by_name_v1["Alpha"]["rank"], int)
    assert by_name_v1["Alpha"]["level"] == 250
    assert by_name_v1["Alpha"]["job"] == "Hero"
    assert isinstance(by_name_v1["Alpha"]["history"], list)
    assert by_name_v1["Alpha"]["characterAssetKey"] == "a1"
    assert by_name_v1["Gamma"]["previousRank"] is None
    assert by_name_v1["Alpha"]["previousRank"] == 2
    assert by_name_v1["Alpha"]["rankFluctuation"] == 1
    assert by_name_v1["Beta"]["rankFluctuation"] == -1
    assert by_name_v1["Gamma"]["rankFluctuation"] == 0

    summary, shards = build_v2_payloads(payload, shard_count=4)
    by_name_v2 = {c["name"]: c for c in summary["characters"]}
    for name, v1_char in by_name_v1.items():
        v2_char = by_name_v2[name]
        for key, value in v1_char.items():
            if key == "history":
                continue
            assert v2_char[key] == value, f"{name}.{key} changed between v1 and v2"
        assert "history" not in v2_char
    assert summary["meta"]["dataFormatVersion"] == 2
