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
def test_build_item_list_yields_exactly_31_items() -> None:
    """SH-22: 28 priority items + 2 explicit additions (Magic Eyepatch /
    Berserked, IMPL_PLAN_SH22 §1) -- was 28 before SH-22. SH-30: +1 more
    (Dreamy Belt, IMPL_PLAN_SH30 §2) -- 31 total."""
    payload = gen_item_list.build_item_list()
    assert len(payload["items"]) == gen_item_list.EXPECTED_ITEM_COUNT == 31


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
    # SH-22: 186 across the original 28 groups + 1 each for the 2 new
    # single-item additions (Magic Eyepatch / Berserked, no aliases of their
    # own, IMPL_PLAN_SH22 §1) = 188. SH-30: +1 for Dreamy Belt (also a
    # single-item group, no aliases of its own, IMPL_PLAN_SH30 §2) = 189.
    assert total_aliases == 189


@pytest.mark.skipif(not SOURCE_REPO_EXISTS, reason="maplenEnhancebot not present on this machine")
def test_build_item_list_includes_sh22_additions() -> None:
    """IMPL_PLAN_SH22 §1/§4(a)/(c): Magic Eyepatch and Berserked are appended
    after the priority set, each as its own single-item group (no aliases),
    with a name resolved from the catalog (not a bare stringified itemId)."""
    payload = gen_item_list.build_item_list()
    by_id = {item["itemId"]: item for item in payload["items"]}

    for item_id, expected_name in {1022278: "Magic Eyepatch", 1012632: "Berserked"}.items():
        assert item_id in by_id, item_id
        item = by_id[item_id]
        assert item["itemName"] == expected_name
        assert item["aliasItemIds"] == [item_id]
        assert item["aliases"] == [{"itemId": item_id, "itemName": expected_name}]

    # Appended after the priority-derived items, not merged/re-sorted into
    # them (plan §3-1 -- keeps the diff against the existing 28 a pure
    # append). SH-30 appended Dreamy Belt after these two, so the tail is now
    # 3 long, still in insertion order (Magic Eyepatch/Berserked/Dreamy Belt).
    ids_in_order = [item["itemId"] for item in payload["items"]]
    assert ids_in_order[-3:] == [1012632, 1022278, 1132308]


@pytest.mark.skipif(not SOURCE_REPO_EXISTS, reason="maplenEnhancebot not present on this machine")
def test_build_item_list_includes_sh30_dreamy_belt_addition() -> None:
    """IMPL_PLAN_SH30 §2: Dreamy Belt (1132308) is appended after the SH-22
    additions as its own single-item group (no aliases), name resolved from
    the catalog -- NOT hardcoded, NOT touching maplenEnhancebot's own
    deliberate exclusion of it from the priority set (GS-257/GS-263,
    priority_equipment.py PARTS_BY_LEVEL["RANGE_200_TO_209"])."""
    payload = gen_item_list.build_item_list()
    by_id = {item["itemId"]: item for item in payload["items"]}

    assert gen_item_list.ADDITIONAL_ITEM_IDS == {1022278, 1012632, 1132308}
    assert 1132308 in by_id
    item = by_id[1132308]
    assert item["itemName"] == "Dreamy Belt"
    assert item["aliasItemIds"] == [1132308]
    assert item["aliases"] == [{"itemId": 1132308, "itemName": "Dreamy Belt"}]

    # Additions and exclusions never target the same item (plan §3-1).
    excluded_ids = {row["itemId"] for row in payload["excluded"]}
    assert gen_item_list.ADDITIONAL_ITEM_IDS.isdisjoint(excluded_ids)


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


def test_active_discovery_groups_returns_empty_list_when_db_missing(tmp_path: Path) -> None:
    assert gen_item_list._active_discovery_groups(tmp_path / "missing.sqlite") == []


def test_active_discovery_groups_returns_empty_list_when_discovery_tables_absent(tmp_path: Path) -> None:
    """A dev DB that predates IMPL_PLAN_SH32 (only the SH-2/SH-3 tables
    applied) -- must degrade to [] rather than raising."""
    import sqlite3

    db_path = tmp_path / "x.sqlite"
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "CREATE TABLE sf_price_history_hourly (item_id INTEGER, item_upgrade INTEGER, price_at TEXT, end_price REAL, sum_enhance_cnt INTEGER, fetched_at TEXT)"
    )
    conn.commit()
    conn.close()
    assert gen_item_list._active_discovery_groups(db_path) == []


def _seed_discovery_group_and_max_upgrade(db_path: Path) -> None:
    """A single active DISCOVERY-monitored group, shaped exactly like the
    real Hat production data (IMPL_PLAN_SH36 §0's own fixture) -- ☆1-10/
    ☆20-22 forming (upgrade 0-9, 19-21), ☆11-19 settled (upgrade 10-18)."""
    conn = db_module.connect(db_path)
    db_module.apply_schema(conn)
    db_module.upsert_discovery_monitored_group(
        conn,
        representative_item_id=1004811,
        item_name="Arcane Umbra Thief Hat",
        equip_level_type="RANGE_200_TO_209",
        equip_type="BOSS_ARCANE_UMBRA_SET",
        equip_part_type="CAP",
        alias_item_ids=[1004808, 1004809, 1004810, 1004811, 1004812],
        aliases=[
            {"itemId": 1004808, "itemName": "Arcane Umbra Knight Hat"},
            {"itemId": 1004809, "itemName": "Arcane Umbra Mage Hat"},
            {"itemId": 1004810, "itemName": "Arcane Umbra Archer Hat"},
            {"itemId": 1004811, "itemName": "Arcane Umbra Thief Hat"},
            {"itemId": 1004812, "itemName": "Arcane Umbra Pirate Hat"},
        ],
        steps_consistent=True,
        is_active=True,
        now="2026-08-21T09:30:15Z",
    )
    for upgrade in range(10, 19):
        db_module.upsert_hourly_rows(
            conn, 1004811, upgrade,
            [{"date": "2026-01-01T00:00:00Z", "endPrice": 1.0, "sumEnhanceCnt": 0}],
            "2026-08-21T00:00:00Z",
        )
    points = lambda step: [{"priceAt": "2026-08-21T09:30:00Z", "endAt": None, "price": 1.0, "step": step}]
    for upgrade in list(range(10)) + [19, 20, 21]:
        db_module.upsert_discovery_price_points(conn, 1004811, upgrade, points("STEP_TYPE_DISCOVERY"), "2026-08-21T09:30:05Z")
    for upgrade in range(10, 19):
        db_module.upsert_discovery_price_points(conn, 1004811, upgrade, points("STEP_TYPE_CHANGE"), "2026-08-21T09:30:05Z")
    conn.close()


@pytest.mark.skipif(not SOURCE_REPO_EXISTS, reason="maplenEnhancebot not present on this machine")
def test_build_item_list_appends_an_active_discovery_group_not_in_the_catalog(tmp_path: Path) -> None:
    """IMPL_PLAN_SH36 §2-1/§6(a)/(c): a DISCOVERY-monitored group with no
    catalog/priority resolution is appended AFTER every catalog-derived item,
    using the SAME representative/aliases/name scan_discovery.py already
    fixed -- never re-derived."""
    db_path = tmp_path / "x.sqlite"
    _seed_discovery_group_and_max_upgrade(db_path)

    baseline = gen_item_list.build_item_list()
    with_discovery = gen_item_list.build_item_list(db_path=db_path)

    assert len(with_discovery["items"]) == len(baseline["items"]) + 1
    appended = with_discovery["items"][-1]
    assert appended["itemId"] == 1004811
    assert appended["itemName"] == "Arcane Umbra Thief Hat"
    assert appended["aliasItemIds"] == [1004808, 1004809, 1004810, 1004811, 1004812]
    assert appended["maxStar"] == 22  # (d)/§0: union of hourly (18) and discovery (21) -> +1
    alias_names = {a["itemId"]: a["itemName"] for a in appended["aliases"]}
    assert alias_names[1004811] == "Arcane Umbra Thief Hat"
    assert alias_names[1004808] == "Arcane Umbra Knight Hat"


@pytest.mark.skipif(not SOURCE_REPO_EXISTS, reason="maplenEnhancebot not present on this machine")
def test_build_item_list_leaves_the_existing_catalog_items_byte_identical(tmp_path: Path) -> None:
    """IMPL_PLAN_SH36 §6(b)/(g): appending a DISCOVERY-only group must not
    change a single field of any pre-existing (catalog-derived) item --
    compared field-for-field against a run with no DISCOVERY data at all
    (`generatedAt`/`sourceCommit` excluded -- both are wall-clock/VCS
    stamps, not part of this plan's "1 byte" claim, matching (b)'s own
    carve-out)."""
    db_path = tmp_path / "x.sqlite"
    _seed_discovery_group_and_max_upgrade(db_path)

    baseline = gen_item_list.build_item_list()
    with_discovery = gen_item_list.build_item_list(db_path=db_path)

    assert with_discovery["excluded"] == baseline["excluded"]
    assert with_discovery["items"][: len(baseline["items"])] == baseline["items"]


@pytest.mark.skipif(not SOURCE_REPO_EXISTS, reason="maplenEnhancebot not present on this machine")
def test_build_item_list_does_not_double_add_a_discovery_group_already_in_the_catalog() -> None:
    """Defensive: if a discovery-monitored representative's itemId happens to
    already be resolvable via the catalog path, it must not be appended a
    second time (IMPL_PLAN_SH36 §2-1)."""
    baseline = gen_item_list.build_item_list()
    existing_id = baseline["items"][0]["itemId"]

    import sqlite3
    import tempfile
    from pathlib import Path as _Path

    with tempfile.TemporaryDirectory() as tmp:
        db_path = _Path(tmp) / "x.sqlite"
        conn = db_module.connect(db_path)
        db_module.apply_schema(conn)
        db_module.upsert_discovery_monitored_group(
            conn,
            representative_item_id=existing_id,
            item_name="Should Not Duplicate",
            equip_level_type="RANGE_200_TO_209",
            equip_type="X",
            equip_part_type="Y",
            alias_item_ids=[existing_id],
            aliases=[{"itemId": existing_id, "itemName": "Should Not Duplicate"}],
            steps_consistent=True,
            is_active=True,
            now="2026-08-21T00:00:00Z",
        )
        conn.close()
        result = gen_item_list.build_item_list(db_path=db_path)

    ids = [item["itemId"] for item in result["items"]]
    assert ids.count(existing_id) == 1
    assert len(result["items"]) == len(baseline["items"])


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
