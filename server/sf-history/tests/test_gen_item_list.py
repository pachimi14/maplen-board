from __future__ import annotations

import pytest

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
def test_build_item_list_records_source_commit() -> None:
    payload = gen_item_list.build_item_list()
    assert len(payload["sourceCommit"]) == 40  # full git SHA
    assert payload["sourceRepo"] == "maplenEnhancebot"
