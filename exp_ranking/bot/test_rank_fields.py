"""Fixture-driven tests for T1 rank-derived fields.

Covers `docs/IMPL_PLAN_T1.md` §4 acceptance tests #1-#10 plus the sign /
missing-job exception-safety checks. All fixtures are hand-built (no
dependency on external API data or the live database) per PR-004.
"""

from __future__ import annotations

import copy
import random

from mvp_export import build_mvp_characters, build_mvp_payload, build_v2_payloads
from models import SnapshotRow


# ---------------------------------------------------------------------------
# rankFluctuation + previousRank (IMPL_PLAN commit 1)
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# jobRank/jobRankTotal + worldRank/worldRankTotal (IMPL_PLAN commit 2)
# ---------------------------------------------------------------------------


def _mixed_population() -> tuple[list[SnapshotRow], dict[str, str]]:
    """6 characters, 2 job groups + 1 job-missing, 2 world groups + 1 world-missing.

    rank is globally unique (1..6), mirroring the real API's daily-unique rank.
    """
    snapshots = [
        SnapshotRow("2026-07-02", 1, 0, "C1", "", "HERO", 260, 900, "", "a1"),
        SnapshotRow("2026-07-02", 3, 0, "C2", "", "HERO", 245, 400, "", "a2"),
        SnapshotRow("2026-07-02", 2, 0, "C3", "", "PALADIN", 255, 700, "", "a3"),
        SnapshotRow("2026-07-02", 5, 0, "C4", "", "PALADIN", 235, 100, "", "a4"),
        SnapshotRow("2026-07-02", 4, 0, "C5", "", "PALADIN", 240, 200, "", "a5"),
        SnapshotRow("2026-07-02", 6, 0, "C6", "", "", 225, 10, "", "a6"),
    ]
    character_meta = {
        "a1": "Ain",
        "a2": "Errai",
        "a3": "Errai",
        "a4": "Ain",
        "a5": "Ain",
        # a6 intentionally absent -> worldId missing entirely
    }
    return snapshots, character_meta


def test_job_and_world_ranks_are_computed_independently() -> None:
    """#1: job and world groupings each get their own 1-based numbering."""
    snapshots, character_meta = _mixed_population()
    characters = build_mvp_characters(
        snapshots, [], latest_snapshot_date="2026-07-02", character_meta=character_meta
    )
    by_name = {c["name"]: c for c in characters}

    # Job groups: Hero = {C1(rank1), C2(rank3)}; Paladin = {C3(2), C5(4), C4(5)}.
    assert (by_name["C1"]["jobRank"], by_name["C1"]["jobRankTotal"]) == (1, 2)
    assert (by_name["C2"]["jobRank"], by_name["C2"]["jobRankTotal"]) == (2, 2)
    assert (by_name["C3"]["jobRank"], by_name["C3"]["jobRankTotal"]) == (1, 3)
    assert (by_name["C5"]["jobRank"], by_name["C5"]["jobRankTotal"]) == (2, 3)
    assert (by_name["C4"]["jobRank"], by_name["C4"]["jobRankTotal"]) == (3, 3)

    # World groups: Ain = {C1(1), C5(4), C4(5)}; Errai = {C3(2), C2(3)}.
    assert (by_name["C1"]["worldRank"], by_name["C1"]["worldRankTotal"]) == (1, 3)
    assert (by_name["C5"]["worldRank"], by_name["C5"]["worldRankTotal"]) == (2, 3)
    assert (by_name["C4"]["worldRank"], by_name["C4"]["worldRankTotal"]) == (3, 3)
    assert (by_name["C3"]["worldRank"], by_name["C3"]["worldRankTotal"]) == (1, 2)
    assert (by_name["C2"]["worldRank"], by_name["C2"]["worldRankTotal"]) == (2, 2)


def test_job_missing_yields_null_without_raising() -> None:
    """job-missing character: jobRank/jobRankTotal null, no exception raised,
    and other characters' job ranks are unaffected."""
    snapshots, character_meta = _mixed_population()
    characters = build_mvp_characters(
        snapshots, [], latest_snapshot_date="2026-07-02", character_meta=character_meta
    )
    by_name = {c["name"]: c for c in characters}
    assert by_name["C6"]["job"] == "Unknown"
    assert by_name["C6"]["jobRank"] is None
    assert by_name["C6"]["jobRankTotal"] is None
    # C6 must not have silently joined an "Unknown" job group with others.
    assert by_name["C1"]["jobRankTotal"] == 2


def test_world_rank_null_for_none_empty_or_missing_world_id() -> None:
    """#8: worldId None/empty/missing never forms a fabricated group."""
    snapshots, character_meta = _mixed_population()
    # a4 explicitly maps to empty string (simulates a cleared/empty worldId).
    character_meta = {**character_meta, "a4": ""}
    characters = build_mvp_characters(
        snapshots, [], latest_snapshot_date="2026-07-02", character_meta=character_meta
    )
    by_name = {c["name"]: c for c in characters}

    # a6 has no character_meta entry at all -> worldId key absent.
    assert "worldId" not in by_name["C6"]
    assert by_name["C6"]["worldRank"] is None
    assert by_name["C6"]["worldRankTotal"] is None

    # a4 explicitly empty string -> also null, and does not join C6's "group".
    assert by_name["C4"].get("worldId") in (None, "")
    assert by_name["C4"]["worldRank"] is None
    assert by_name["C4"]["worldRankTotal"] is None

    # Ain now only has C1 and C5 (C4 dropped out) -> total shrinks to 2.
    assert (by_name["C1"]["worldRank"], by_name["C1"]["worldRankTotal"]) == (1, 2)
    assert (by_name["C5"]["worldRank"], by_name["C5"]["worldRankTotal"]) == (2, 2)


def test_job_and_world_totals_reflect_full_population_before_truncation() -> None:
    """#3: export_top_n truncates the *output*, not the ranking population."""
    snapshots, character_meta = _mixed_population()
    characters = build_mvp_characters(
        snapshots,
        [],
        latest_snapshot_date="2026-07-02",
        character_meta=character_meta,
        export_top_n=3,
    )
    # Only rank 1..3 (C1, C3, C2) survive truncation.
    assert [c["name"] for c in characters] == ["C1", "C3", "C2"]
    by_name = {c["name"]: c for c in characters}

    # Paladin group total is still 3 (C3, C4, C5) even though C4/C5 were
    # truncated out of the exported list.
    assert by_name["C3"]["jobRankTotal"] == 3
    # Hero group total is still 2 (C1, C2).
    assert by_name["C1"]["jobRankTotal"] == 2
    assert by_name["C2"]["jobRankTotal"] == 2
    # Ain world group total is still 3 (C1, C4, C5).
    assert by_name["C1"]["worldRankTotal"] == 3


def test_input_order_does_not_affect_output_ranking() -> None:
    """#2: reordering the input snapshot list yields identical ranking output
    (stable sort by (rank, historyKey))."""
    snapshots, character_meta = _mixed_population()
    shuffled = list(snapshots)
    random.Random(42).shuffle(shuffled)
    assert shuffled != snapshots  # sanity: the shuffle actually changed order

    characters_a = build_mvp_characters(
        snapshots, [], latest_snapshot_date="2026-07-02", character_meta=character_meta
    )
    characters_b = build_mvp_characters(
        shuffled, [], latest_snapshot_date="2026-07-02", character_meta=character_meta
    )
    assert characters_a == characters_b


# ---------------------------------------------------------------------------
# Existing-field invariance (#10) across v1 and v2 payload shapes.
# ---------------------------------------------------------------------------


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
