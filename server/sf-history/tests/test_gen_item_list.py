from __future__ import annotations

from pathlib import Path

import pytest

import db as db_module
import gen_item_list


SOURCE_REPO_EXISTS = gen_item_list.DEFAULT_SOURCE_REPO.exists()


@pytest.mark.skipif(
    not SOURCE_REPO_EXISTS,
    reason="maplenEnhancebot not present on this machine (SH-2 is a local-only tool, plan §4)",
)
def test_build_item_list_yields_exactly_28_items() -> None:
    payload = gen_item_list.build_item_list()
    assert len(payload["items"]) == gen_item_list.EXPECTED_ITEM_COUNT == 28


@pytest.mark.skipif(not SOURCE_REPO_EXISTS, reason="maplenEnhancebot not present on this machine")
def test_build_item_list_excludes_exactly_the_two_designated_items() -> None:
    payload = gen_item_list.build_item_list()
    excluded_ids = {row["itemId"] for row in payload["excluded"]}
    assert excluded_ids == {1113282, 1122254}
    for row in payload["excluded"]:
        assert row["reason"]  # non-empty -- plan §4 "除外理由を JSON に残す"
    kept_ids = {item["itemId"] for item in payload["items"]}
    assert excluded_ids.isdisjoint(kept_ids)


@pytest.mark.skipif(not SOURCE_REPO_EXISTS, reason="maplenEnhancebot not present on this machine")
def test_build_item_list_items_have_no_duplicate_ids_and_self_inclusive_aliases() -> None:
    payload = gen_item_list.build_item_list()
    ids = [item["itemId"] for item in payload["items"]]
    assert len(ids) == len(set(ids))
    for item in payload["items"]:
        assert item["itemId"] in item["aliasItemIds"]
        assert item["aliasItemIds"] == sorted(item["aliasItemIds"])


@pytest.mark.skipif(not SOURCE_REPO_EXISTS, reason="maplenEnhancebot not present on this machine")
def test_build_item_list_aliases_cover_all_alias_ids_with_real_names() -> None:
    """IMPL_PLAN_SH9 §3-1/(b): 186 total aliases across the 28 groups, every
    one with a name resolved from maplenEnhancebot's catalog (never a bare
    stringified itemId -- that fallback exists in the code for future data
    drift, not for today's known 28 groups)."""
    payload = gen_item_list.build_item_list()
    total_aliases = 0
    for item in payload["items"]:
        alias_ids_by_id = {a["itemId"] for a in item["aliases"]}
        assert alias_ids_by_id == set(item["aliasItemIds"])
        assert item["itemId"] in alias_ids_by_id  # representative included, plan §3-1
        for alias in item["aliases"]:
            assert alias["itemName"], alias
            assert alias["itemName"] != str(alias["itemId"]), (
                f"itemId {alias['itemId']} fell back to its raw id -- "
                "no catalog name resolved (plan §3-1 acceptance (b))"
            )
        total_aliases += len(item["aliases"])
    assert total_aliases == 186


@pytest.mark.skipif(not SOURCE_REPO_EXISTS, reason="maplenEnhancebot not present on this machine")
def test_build_item_list_records_source_commit() -> None:
    payload = gen_item_list.build_item_list()
    assert len(payload["sourceCommit"]) == 40  # full git SHA


@pytest.mark.skipif(not SOURCE_REPO_EXISTS, reason="maplenEnhancebot not present on this machine")
def test_excluded_reason_attributes_to_the_users_explicit_draft_choice() -> None:
    """IMPL_PLAN_SH3 §4(m): the SH-2 reconstructed rationale must be superseded --
    the correct out-cited source is the user's explicit exclusion, not a
    level-band inference."""
    payload = gen_item_list.build_item_list()
    for row in payload["excluded"]:
        assert "user" in row["reason"].lower()
        assert "explicit" in row["reason"].lower()


def test_max_upgrade_by_item_returns_empty_dict_when_db_missing(tmp_path: Path) -> None:
    assert gen_item_list._max_upgrade_by_item(tmp_path / "missing.sqlite") == {}


def test_max_upgrade_by_item_reads_real_db(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    conn = db_module.connect(db_path)
    db_module.apply_schema(conn)
    db_module.upsert_hourly_rows(
        conn, 1, 5, [{"date": "2026-01-01T00:00:00Z", "endPrice": 1.0, "sumEnhanceCnt": 0}], "2026-08-05T00:00:00Z"
    )
    db_module.upsert_hourly_rows(
        conn, 1, 19, [{"date": "2026-01-01T00:00:00Z", "endPrice": 1.0, "sumEnhanceCnt": 0}], "2026-08-05T00:00:00Z"
    )
    conn.close()

    assert gen_item_list._max_upgrade_by_item(db_path) == {1: 19}


@pytest.mark.skipif(not SOURCE_REPO_EXISTS, reason="maplenEnhancebot not present on this machine")
def test_build_item_list_derives_max_star_from_real_db() -> None:
    """design §7.1: maxStar must come from data, matching the six known
    ☆20-capped items and every other item at ☆22 (IMPL_PLAN_SH3 §7(l))."""
    payload = gen_item_list.build_item_list()
    by_id = {item["itemId"]: item for item in payload["items"]}

    star20_ids = {1022232, 1032241, 1072972, 1082613, 1102713, 1212102}
    star20_present = star20_ids & set(by_id)
    for item_id in star20_present:
        assert by_id[item_id]["maxStar"] == 20, item_id
    for item_id, item in by_id.items():
        if item_id not in star20_ids:
            assert item["maxStar"] in (22, None), item_id
    assert payload["sourceRepo"] == "maplenEnhancebot"
