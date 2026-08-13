from __future__ import annotations

import sqlite3

from item_metadata_store import ItemMetadataStore


def metadata(item_id: int, name: str = "Phantasma Coin") -> dict:
    return {
        "itemId": item_id,
        "itemName": name,
        "categoryLabel": "Currency",
        "tier0": "Etc",
        "tier1": "Exchange Currency",
        "imageUrl": f"https://api-static.msu.io/itemimages/icon/{item_id}.png",
    }


def test_metadata_persists_across_store_instances(tmp_path) -> None:
    path = tmp_path / "item-metadata.sqlite3"
    first = ItemMetadataStore(path, ttl_seconds=300, clock=lambda: 100.0)
    assert first.save(4310218, metadata(4310218)) is True

    second = ItemMetadataStore(path, ttl_seconds=300, clock=lambda: 110.0)
    loaded = second.load(4310218)

    assert loaded is not None
    value, remaining_ttl = loaded
    assert value == metadata(4310218)
    assert remaining_ttl == 290.0


def test_expired_metadata_is_deleted(tmp_path) -> None:
    path = tmp_path / "item-metadata.sqlite3"
    store = ItemMetadataStore(path, ttl_seconds=10, clock=lambda: 100.0)
    assert store.save(4310218, metadata(4310218)) is True

    assert store.load(4310218, now=110.0) is None
    assert store.count() == 0


def test_only_normalized_public_fields_are_stored(tmp_path) -> None:
    path = tmp_path / "item-metadata.sqlite3"
    store = ItemMetadataStore(path)
    value = {**metadata(4310218), "walletAddress": "must-not-be-stored", "assetKey": "must-not-be-stored"}

    assert store.save(4310218, value) is True
    loaded, _remaining_ttl = store.load(4310218)
    assert set(loaded) == {"itemId", "itemName", "categoryLabel", "tier0", "tier1", "imageUrl"}
    with sqlite3.connect(path) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(item_metadata_cache)")}
    assert "walletAddress" not in columns
    assert "assetKey" not in columns


def test_invalid_or_failed_metadata_is_not_saved(tmp_path) -> None:
    store = ItemMetadataStore(tmp_path / "item-metadata.sqlite3")

    assert store.save(4310218, {**metadata(4310218), "itemName": ""}) is False
    assert store.save(4310218, {**metadata(4310218), "imageUrl": "https://tracking.example/item.png"}) is False
    assert store.count() == 0


def test_store_prunes_oldest_entries_to_the_bound(tmp_path) -> None:
    now = {"value": 100.0}
    store = ItemMetadataStore(
        tmp_path / "item-metadata.sqlite3",
        max_entries=2,
        clock=lambda: now["value"],
    )
    for item_id in (101, 102, 103):
        assert store.save(item_id, metadata(item_id, f"Item {item_id}")) is True
        now["value"] += 1

    assert store.count() == 2
    assert store.load(101) is None
    assert store.load(102) is not None
    assert store.load(103) is not None