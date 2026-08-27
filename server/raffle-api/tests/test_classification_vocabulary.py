from __future__ import annotations

import json
from pathlib import Path

import pytest

from normalizer import _classification

# Real-metadata regression guard (LULU-119 / docs/IMPL_PLAN_RAFFLE_DROP_CLASSIFY.md §F1-3).
#
# The fixture is a machine snapshot of the official item metadata vocabulary actually
# observed in production (236 entries: itemId / itemName / tier0 / tier1 only), plus 6
# real-data Rank 2-7 Special Skill Ring Box entries added for
# docs/IMPL_PLAN_RAFFLE_REWARD_VOCAB.md S2 (242 total). It is intentionally NOT hand-authored
# so that `_classification` regressions against the real tier0/tier1 vocabulary are caught
# even when synthetic unit-test fixtures stay green.
#
# Known-vocabulary table (must stay in sync with the production snapshot):
#   tier0=Item,       tier1 in {Decoration, Armor, Utility, Set-up, Weapon} -> EQUIPMENT
#   tier0=Consumable, tier1=Exchange Currency, name in TARGET_COINS         -> COIN
#   tier0=Consumable, tier1=Exchange Currency, other names                 -> OTHER
#   tier0=Consumable, tier1=ETC (Power Crystal Coupon)                     -> POWER_CRYSTAL
#   tier0=Consumable, tier1=Voucher, name == "Sealed Mirror World Nodestone" -> FT_ITEM
#   tier0=Consumable, tier1=Voucher, name ends with "Ring Box"             -> EQUIPMENT
#   tier0=Consumable, tier1=Voucher, other names (e.g. "Sealed Nodestone") -> OTHER
KNOWN_VOCABULARY = {
    ("Item", "Decoration"): "EQUIPMENT",
    ("Item", "Armor"): "EQUIPMENT",
    ("Item", "Utility"): "EQUIPMENT",
    ("Item", "Set-up"): "EQUIPMENT",
    ("Item", "Weapon"): "EQUIPMENT",
    ("Consumable", "Exchange Currency"): None,  # resolved per-item below (COIN vs OTHER)
    ("Consumable", "ETC"): "POWER_CRYSTAL",
    ("Consumable", "Voucher"): None,  # resolved per-item below (FT_ITEM vs EQUIPMENT vs OTHER)
}
TARGET_COIN_NAMES = {"Phantasma Coin", "Arachno Coin"}
FT_ITEM_NAME = "Sealed Mirror World Nodestone"
RING_BOX_NAME_SUFFIX = "Ring Box"


def _load_vocabulary() -> list[dict]:
    root = Path(__file__).resolve().parents[3]
    path = root / "testdata" / "raffle" / "v1" / "item-metadata-vocabulary.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _expected_classification(entry: dict) -> str:
    tier0 = entry.get("tier0")
    tier1 = entry.get("tier1")
    name = entry.get("itemName")
    key = (tier0, tier1)
    if key not in KNOWN_VOCABULARY:
        raise AssertionError(
            f"Unknown (tier0, tier1) vocabulary pair {key!r} for item {entry!r}. "
            "This is a new upstream vocabulary that _classification's known table does not "
            "yet cover -- update KNOWN_VOCABULARY (and _classification if needed) deliberately."
        )
    if key == ("Consumable", "Exchange Currency"):
        return "COIN" if name in TARGET_COIN_NAMES else "OTHER"
    if key == ("Consumable", "Voucher"):
        if name == FT_ITEM_NAME:
            return "FT_ITEM"
        return "EQUIPMENT" if name.endswith(RING_BOX_NAME_SUFFIX) else "OTHER"
    return KNOWN_VOCABULARY[key]


VOCABULARY = _load_vocabulary()


def test_vocabulary_fixture_has_expected_size() -> None:
    assert len(VOCABULARY) == 242


@pytest.mark.parametrize("entry", VOCABULARY, ids=lambda entry: f"{entry['itemId']}:{entry['itemName']}")
def test_classification_matches_expected_for_every_real_vocabulary_entry(entry: dict) -> None:
    classification, _name = _classification(entry["itemId"], entry)
    assert classification == _expected_classification(entry)


def test_all_vocabulary_pairs_are_known() -> None:
    observed_pairs = {(entry.get("tier0"), entry.get("tier1")) for entry in VOCABULARY}
    assert observed_pairs <= set(KNOWN_VOCABULARY.keys())


def test_equipment_covers_all_220_item_tier0_entries() -> None:
    item_entries = [entry for entry in VOCABULARY if entry["tier0"] == "Item"]
    assert len(item_entries) == 220
    assert all(_classification(entry["itemId"], entry)[0] == "EQUIPMENT" for entry in item_entries)


def test_sealed_mirror_world_nodestone_is_ft_item_and_sealed_nodestone_is_other() -> None:
    ft_item = next(entry for entry in VOCABULARY if entry["itemName"] == "Sealed Mirror World Nodestone")
    generic = next(entry for entry in VOCABULARY if entry["itemName"] == "Sealed Nodestone")
    assert _classification(ft_item["itemId"], ft_item) == ("FT_ITEM", "Sealed Mirror World Nodestone")
    assert _classification(generic["itemId"], generic) == ("OTHER", "Sealed Nodestone")


def test_ring_boxes_are_equipment_and_generic_sealed_nodestone_stays_other() -> None:
    # docs/IMPL_PLAN_RAFFLE_REWARD_VOCAB.md S2: Ring Box (tier1=Voucher, name-suffix match) is
    # now sellable EQUIPMENT; the still-excluded Sealed Nodestone (same tier0/tier1) is
    # unaffected -- only the Ring Box name distinguishes them.
    ring_boxes = [entry for entry in VOCABULARY if entry["itemName"].endswith(RING_BOX_NAME_SUFFIX)]
    assert len(ring_boxes) == 6
    assert all(_classification(entry["itemId"], entry)[0] == "EQUIPMENT" for entry in ring_boxes)
    generic = next(entry for entry in VOCABULARY if entry["itemName"] == "Sealed Nodestone")
    assert _classification(generic["itemId"], generic)[0] == "OTHER"


def test_power_crystal_coupons_are_classified() -> None:
    coupons = [entry for entry in VOCABULARY if entry["itemName"].endswith("Power Crystal Coupon")]
    assert len(coupons) == 4
    assert all(_classification(entry["itemId"], entry)[0] == "POWER_CRYSTAL" for entry in coupons)


def test_target_coins_are_classified_as_coin() -> None:
    coins = [entry for entry in VOCABULARY if entry["itemName"] in TARGET_COIN_NAMES]
    assert len(coins) == 2
    assert all(_classification(entry["itemId"], entry)[0] == "COIN" for entry in coins)


def test_non_target_exchange_currencies_fall_back_to_other() -> None:
    names = {"Green Florin", "Blue Florin", "Red Florin", "Gold Florin", "AbsoLab Coin", "Stigma Coin"}
    entries = [entry for entry in VOCABULARY if entry["itemName"] in names]
    assert len(entries) == len(names)
    assert all(_classification(entry["itemId"], entry)[0] == "OTHER" for entry in entries)
