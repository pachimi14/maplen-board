from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from contracts import CreateJobRequest


SCHEMA_VERSION = 3
CLASSIFICATION_VERSION = 2
TARGET_BOSSES = {"Lucid": "LUCID", "Will": "WILL"}
TARGET_COINS = {"LUCID": "Phantasma Coin", "WILL": "Arachno Coin"}
FT_ITEM_NAME = "Sealed Mirror World Nodestone"
ASCENDANT_TIER_BY_BOSS = {
    ("LUCID", "DIFFICULTY_EASY"): "Dawning Ascendant 2",
    ("LUCID", "DIFFICULTY_NORMAL"): "Mystic Ascendant",
    ("LUCID", "DIFFICULTY_HARD"): "Divine Ascendant",
    ("WILL", "DIFFICULTY_EASY"): "Luminous Ascendant",
    ("WILL", "DIFFICULTY_NORMAL"): "Glorious Ascendant",
    ("WILL", "DIFFICULTY_HARD"): "Eternal Ascendant",
}
BOSS_DIFFICULTIES = {"DIFFICULTY_EASY": "EASY", "DIFFICULTY_NORMAL": "NORMAL", "DIFFICULTY_HARD": "HARD"}
CLEAR_CLUSTER_WINDOW = timedelta(hours=1)
POWER_CRYSTAL_PATTERN = re.compile(
    r"^(?P<amount>\d+)(?P<suffix>[KM]?) Power Crystal Coupon$", re.IGNORECASE
)

def _drops(boss: str, member_index: int) -> list[dict]:
    drops = []
    if member_index == 0:
        drops.append({"dropId": f"fixture-{boss.lower()}-coin", "category": "COIN", "name": "Phantasma Coin" if boss == "LUCID" else "Arachno Coin", "quantity": "10"})
    if member_index == 1:
        drops.append({"dropId": f"fixture-{boss.lower()}-equipment", "category": "EQUIPMENT", "name": f"Fixture {boss.title()} Equipment", "quantity": "1"})
    return drops


def _fixture_wallet_address(asset_key: str) -> str:
    # Deterministic 0x + 40 hex chars so fixture (dev/CI) mode can exercise
    # the memberWallets contract end-to-end without a real MSU wallet.
    return "0x" + hashlib.sha1(asset_key.encode("utf-8")).hexdigest()[:40]


def fixture_result(request: CreateJobRequest) -> dict:
    raffle_results = []
    for character in request.characters:
        for boss, coin in (("LUCID", "Phantasma Coin"), ("WILL", "Arachno Coin")):
            raffle_results.append({"resultId": f"fixture-{boss.lower()}-{character.memberId}", "memberId": character.memberId, "raffledAt": request.raffledAt, "layerName": f"Fixture {boss.title()}", "bossCode": boss, "bossName": boss.title(), "outcome": "WIN", "rewards": [{"rewardName": coin, "classification": "COIN", "quantity": "10", "won": True}]})
        raffle_results.append({"resultId": f"fixture-other-{character.memberId}", "memberId": character.memberId, "raffledAt": request.raffledAt, "layerName": "Fixture Other Boss", "bossCode": None, "bossName": "Other Boss", "outcome": "WIN", "rewards": [{"rewardName": "Fixture Other Reward", "classification": "OTHER", "quantity": "1", "won": True}]})
    clears = []
    for boss in ("LUCID", "WILL"):
        difficulty, ascendant_tier = ("HARD", "Divine Ascendant") if boss == "LUCID" else ("HARD", "Eternal Ascendant")
        members = []
        for index, character in enumerate(request.characters):
            members.append({"memberId": character.memberId, "bossNeso": "600" if index == 0 else "0", "powerCrystalAmount": "100" if index == 0 else "0", "ascendantNeso": "50" if index == 0 else "0", "drops": _drops(boss, index)})
        clears.append({"clearId": "fixture-" + boss.lower(), "boss": boss, "bossDifficulty": difficulty, "ascendantTier": ascendant_tier, "partyCount": len(request.characters), "historyMemberIds": [character.memberId for character in request.characters], "complete": True, "members": members})
    member_wallets = {character.memberId: character.walletOverride or _fixture_wallet_address(character.assetKey) for character in request.characters}
    return {"raffleResults": raffle_results, "clears": clears, "warnings": [{"code": "fixture_mode"}], "errors": [], "memberWallets": member_wallets}


def _text(value: object) -> str:
    return str(value).strip() if value is not None else ""


def _integer(value: object) -> int:
    if isinstance(value, dict):
        value = value.get("value")
    if isinstance(value, bool):
        return 0
    try:
        decimal_value = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return 0
    if not decimal_value.is_finite() or decimal_value < 0 or decimal_value != decimal_value.to_integral_value():
        return 0
    return int(decimal_value)


def _item_id(prize: dict) -> int:
    value = prize.get("itemId")
    if value is None and isinstance(prize.get("rewardKey"), dict):
        value = prize["rewardKey"].get("itemId")
    if value is None and isinstance(prize.get("item"), dict):
        value = prize["item"].get("itemId")
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _quantity(prize: dict) -> int:
    return _integer(prize.get("winCount"))


def _prizes(history: dict) -> list[dict]:
    values = history.get("prizes")
    return [value for value in values if isinstance(value, dict)] if isinstance(values, list) else []


def _layer_id(history: dict) -> str:
    return _text(history.get("layerId"))


def _layer_names(layer: dict | None) -> tuple[str, str, str | None]:
    if not isinstance(layer, dict):
        return "Unknown Layer", "Unknown", None
    boss = layer.get("boss") if isinstance(layer.get("boss"), dict) else {}
    contents = layer.get("contents") if isinstance(layer.get("contents"), dict) else {}
    boss_name = _text(boss.get("bossName"))
    layer_name = _text(boss.get("raffleLayerName")) or _text(contents.get("raffleLayerName")) or _text(contents.get("layerName")) or boss_name or "Unknown Layer"
    display_name = boss_name or _text(contents.get("groupName")) or _text(contents.get("layerName")) or layer_name
    return layer_name, display_name, TARGET_BOSSES.get(boss_name)


def _classification(item_id: int, metadata: dict | None) -> tuple[str, str]:
    if item_id == 1:
        return "NESO", "NESO"
    name = _text((metadata or {}).get("itemName")) or f"Item {item_id}"
    if name in TARGET_COINS.values() and _text((metadata or {}).get("tier1")) == "Exchange Currency":
        return "COIN", name
    if POWER_CRYSTAL_PATTERN.fullmatch(name):
        return "POWER_CRYSTAL", name
    if name == FT_ITEM_NAME:
        return "FT_ITEM", name
    if _text((metadata or {}).get("tier0")) == "Item":
        return "EQUIPMENT", name
    return "OTHER", name


def _item_icon_url(metadata: dict | None) -> str:
    value = _text((metadata or {}).get("imageUrl"))
    return value if value.startswith("https://api-static.msu.io/itemimages/") else ""


def _power_crystal_face_value(metadata: dict | None) -> int:
    match = POWER_CRYSTAL_PATTERN.fullmatch(_text((metadata or {}).get("itemName")))
    if not match:
        return 0
    multiplier = {"": 1, "K": 1_000, "M": 1_000_000}[match.group("suffix").upper()]
    return int(match.group("amount")) * multiplier


def _clear_entries(history: dict) -> list[tuple[datetime, int]]:
    values = history.get("clearInformations")
    if not isinstance(values, list):
        return []
    result = []
    for value in values:
        if not isinstance(value, dict):
            continue
        party_count = _integer(value.get("partyCount"))
        raw_cleared_at = _text(value.get("clearedAt"))
        if raw_cleared_at.endswith("Z"):
            raw_cleared_at = raw_cleared_at[:-1] + "+00:00"
        try:
            cleared_at = datetime.fromisoformat(raw_cleared_at)
        except ValueError:
            continue
        if party_count > 0 and cleared_at.tzinfo is not None:
            result.append((cleared_at.astimezone(timezone.utc), party_count))
    return result


def _one_hour_party_cluster(
    member_histories: dict[str, list[tuple[dict, datetime, int]]],
    expected_party_count: int,
) -> tuple[dict[str, tuple[dict, int]], bool]:
    records = []
    ambiguous = False
    for member_id, values in member_histories.items():
        matching = [value for value in values if value[2] == expected_party_count]
        if len(matching) > 1:
            ambiguous = True
            continue
        if len(matching) == 1:
            history, cleared_at, party_count = matching[0]
            records.append((cleared_at, member_id, history, party_count))
    records.sort(key=lambda value: value[0])
    minimum_members = 1
    best_count = 0
    best_clusters: dict[frozenset[str], list[tuple[datetime, str, dict, int]]] = {}
    right = 0
    for left in range(len(records)):
        if right < left:
            right = left
        while right < len(records) and records[right][0] - records[left][0] <= CLEAR_CLUSTER_WINDOW:
            right += 1
        window = records[left:right]
        if len(window) < minimum_members:
            continue
        member_set = frozenset(value[1] for value in window)
        if len(window) > best_count:
            best_count = len(window)
            best_clusters = {member_set: window}
        elif len(window) == best_count:
            best_clusters[member_set] = window
    if best_count < minimum_members or len(best_clusters) != 1:
        return {}, ambiguous or len(best_clusters) > 1
    cluster = next(iter(best_clusters.values()))
    return {member_id: (history, party_count) for _cleared_at, member_id, history, party_count in cluster}, ambiguous


def _is_ascendant(layer: dict | None) -> bool:
    if not isinstance(layer, dict):
        return False
    contents = layer.get("contents") if isinstance(layer.get("contents"), dict) else {}
    values = (_text(contents.get("groupName")), _text(contents.get("layerName")), _text(contents.get("raffleLayerName")))
    return any("ascendant" in value.casefold() for value in values)


def _boss_distribution_context(layer: dict | None) -> tuple[str, str] | None:
    if not isinstance(layer, dict):
        return None
    boss = layer.get("boss") if isinstance(layer.get("boss"), dict) else {}
    boss_code = TARGET_BOSSES.get(_text(boss.get("bossName")))
    raw_difficulty = _text(boss.get("difficulty"))
    difficulty = BOSS_DIFFICULTIES.get(raw_difficulty)
    tier = ASCENDANT_TIER_BY_BOSS.get((boss_code, raw_difficulty))
    return (difficulty, tier) if difficulty and tier else None

def _ascendant_for_boss(histories: list[dict], layers_by_id: dict[str, dict], boss_history: dict) -> tuple[dict | None, str | None]:
    """Resolves the Ascendant-tier history entry that matches the boss/difficulty's target
    tier (LULU-1xx). The upstream API has renamed/split Ascendant layer names before (e.g. a
    single "Eternal Ascendant" tier became "Eternal Ascendant Hard Will" and
    "Eternal Ascendant Chaos Guardian" per boss), so exact-name matching alone is not
    reliable. Falls back to a prefix match, then narrows by the boss's own display name when
    several tier variants share the same prefix.

    Returns `(ascendant_history, missing_tier)`. `missing_tier` is set (with
    `ascendant_history` left `None`) only when a target tier was expected but could not be
    uniquely resolved, so the caller can raise a visible `ascendant_not_found` warning instead
    of silently treating Power Crystal/Ascendant NESO as zero.
    """
    boss_layer = layers_by_id.get(_layer_id(boss_history))
    if not isinstance(boss_layer, dict):
        return None, None
    context = _boss_distribution_context(boss_layer)
    if context is None:
        return None, None
    _difficulty, target_tier = context
    _boss_layer_name, boss_display_name, _boss_code = _layer_names(boss_layer)
    target_tier_cf = target_tier.casefold()
    boss_display_cf = boss_display_name.casefold()

    candidates: list[tuple[str, dict]] = []
    for history in histories:
        layer = layers_by_id.get(_layer_id(history))
        if not _is_ascendant(layer):
            continue
        contents = layer.get("contents") if isinstance(layer.get("contents"), dict) else {}
        candidates.append((_text(contents.get("layerName")), history))

    exact = [history for name, history in candidates if name.casefold() == target_tier_cf]
    if len(exact) == 1:
        return exact[0], None
    if len(exact) == 0:
        prefix = [(name, history) for name, history in candidates if name.casefold().startswith(target_tier_cf)]
        if len(prefix) == 1:
            return prefix[0][1], None
        if len(prefix) > 1:
            narrowed = [history for name, history in prefix if boss_display_cf and boss_display_cf in name.casefold()]
            if len(narrowed) == 1:
                return narrowed[0], None
    return None, target_tier


def _sum_item(history: dict | None, item_id: int) -> int:
    if history is None:
        return 0
    return sum(_quantity(prize) for prize in _prizes(history) if _item_id(prize) == item_id)


def _member_settlement(member_id: str, boss_code: str, history: dict, ascendant: dict | None, item_metadata: dict[int, dict], drop_scope: str = "") -> dict:
    drops = []
    drop_prefix = boss_code.lower() + ("-" + drop_scope if drop_scope else "") + "-" + member_id
    coin_name = TARGET_COINS[boss_code]
    coin_quantity = 0
    coin_image_url = ""
    equipment_index = 0
    ft_item_index = 0
    for prize in _prizes(history):
        quantity = _quantity(prize)
        if quantity <= 0:
            continue
        item_id = _item_id(prize)
        classification, name = _classification(item_id, item_metadata.get(item_id))
        if classification == "COIN" and name == coin_name:
            coin_quantity += quantity
            coin_image_url = coin_image_url or _item_icon_url(item_metadata.get(item_id))
        elif classification == "EQUIPMENT":
            equipment_index += 1
            drops.append({"dropId": f"{drop_prefix}-equipment-{equipment_index}", "category": "EQUIPMENT", "name": name, "quantity": str(quantity), "imageUrl": _item_icon_url(item_metadata.get(item_id))})
        elif classification == "FT_ITEM" and boss_code == "WILL":
            # Only surfaced for Will clears (Lucid never rolls this item); the affiliate is
            # asked for a resale price like coin/equipment so it can be settled the same way.
            ft_item_index += 1
            drops.append({"dropId": f"{drop_prefix}-ftitem-{ft_item_index}", "category": "FT_ITEM", "name": name, "quantity": str(quantity), "imageUrl": _item_icon_url(item_metadata.get(item_id))})
    if coin_quantity:
        drops.insert(0, {"dropId": f"{drop_prefix}-coin", "category": "COIN", "name": coin_name, "quantity": str(coin_quantity), "imageUrl": coin_image_url})
    power_crystal = 0
    for prize in _prizes(ascendant or {}):
        quantity = _quantity(prize)
        item_id = _item_id(prize)
        power_crystal += quantity * _power_crystal_face_value(item_metadata.get(item_id))
    return {"memberId": member_id, "bossNeso": str(_sum_item(history, 1)), "powerCrystalAmount": str(power_crystal), "ascendantNeso": str(_sum_item(ascendant, 1)), "drops": drops}


def _empty_member_settlement(member_id: str) -> dict:
    return {"memberId": member_id, "bossNeso": "0", "powerCrystalAmount": "0", "ascendantNeso": "0", "drops": []}


def normalize_live_history(request: CreateJobRequest, character_histories: dict[str, list[dict]], layers: list[dict], item_metadata: dict[int, dict], initial_errors: list[dict] | None = None) -> dict:
    """Normalize upstream data. User-dependent settlement arithmetic remains web-only."""
    errors = list(initial_errors or [])
    warnings: list[dict] = []
    layers_by_id = {_text(layer.get("layerId")): layer for layer in layers}
    exact_histories: dict[str, list[dict]] = {}
    raffle_results = []
    for character in request.characters:
        member_histories = [history for history in character_histories.get(character.memberId, []) if _text(history.get("raffledAt")) == request.raffledAt]
        exact_histories[character.memberId] = member_histories
        for history_index, history in enumerate(member_histories):
            rewards = []
            for prize in _prizes(history):
                quantity = _quantity(prize)
                if quantity <= 0:
                    continue
                item_id = _item_id(prize)
                classification, name = _classification(item_id, item_metadata.get(item_id))
                rewards.append({"rewardName": name, "classification": classification, "quantity": str(quantity), "won": True, "iconUrl": _item_icon_url(item_metadata.get(item_id))})
            if not rewards:
                continue
            layer_name, display_name, boss_code = _layer_names(layers_by_id.get(_layer_id(history)))
            raffle_results.append({"resultId": f"result-{character.memberId}-{history_index + 1}", "memberId": character.memberId, "raffledAt": request.raffledAt, "layerName": layer_name, "bossCode": boss_code, "bossName": display_name, "outcome": "WIN", "rewards": rewards})
    clears = []
    registered_count = len(request.characters)
    difficulty_order = {"HARD": 0, "NORMAL": 1, "EASY": 2}
    for boss_code in ("LUCID", "WILL"):
        histories_by_layer: dict[str, dict[str, list[tuple[dict, datetime, int]]]] = {}
        for character in request.characters:
            for history in exact_histories.get(character.memberId, []):
                layer_id = _layer_id(history)
                _layer_name, _display_name, history_boss = _layer_names(layers_by_id.get(layer_id))
                clear_entries = _clear_entries(history)
                if history_boss != boss_code or not clear_entries:
                    continue
                for cleared_at, party_count in clear_entries:
                    histories_by_layer.setdefault(layer_id, {}).setdefault(character.memberId, []).append((history, cleared_at, party_count))

        candidates = []
        for layer_id, member_histories in histories_by_layer.items():
            distribution_context = _boss_distribution_context(layers_by_id.get(layer_id))
            if distribution_context is None:
                continue
            difficulty, ascendant_tier = distribution_context
            candidates.append((difficulty_order[difficulty], layer_id, difficulty, ascendant_tier, member_histories))

        for _order, layer_id, difficulty, ascendant_tier, member_histories in sorted(candidates):
            observed_party_counts = sorted({
                party_count
                for histories in member_histories.values()
                for _history, _cleared_at, party_count in histories
                if 1 <= party_count <= 6
            })
            # Every observed party size that resolves to a one-hour-window cluster is emitted
            # as its own clear candidate (LULU-096): the same boss/difficulty can legitimately
            # have multiple independent clears (e.g. a 5-person party and a separate 6-person
            # party both clearing Hard Will), and the caller decides which to combine.
            for official_party_count in observed_party_counts:
                cluster, ambiguous = _one_hour_party_cluster(member_histories, official_party_count)
                if cluster and len(cluster) <= official_party_count:
                    if ambiguous:
                        warnings.append({"code": "ambiguous_party_cluster", "boss": boss_code, "bossDifficulty": difficulty, "partyCount": official_party_count})
                    members = []
                    history_member_ids = []
                    for character in request.characters:
                        match = cluster.get(character.memberId)
                        if match is not None:
                            history, _party_count = match
                            ascendant, _missing_tier = _ascendant_for_boss(exact_histories.get(character.memberId, []), layers_by_id, history)
                            members.append(_member_settlement(character.memberId, boss_code, history, ascendant, item_metadata, difficulty.lower()))
                            history_member_ids.append(character.memberId)
                        else:
                            members.append(_empty_member_settlement(character.memberId))
                    clears.append({
                        "clearId": f"clear-{boss_code.lower()}-{difficulty.lower()}-p{official_party_count}",
                        "boss": boss_code,
                        "bossDifficulty": difficulty,
                        "ascendantTier": ascendant_tier,
                        "partyCount": official_party_count,
                        "historyMemberIds": history_member_ids,
                        "complete": True,
                        "members": members,
                    })
                elif ambiguous:
                    warnings.append({"code": "ambiguous_party_cluster", "boss": boss_code, "bossDifficulty": difficulty, "partyCount": official_party_count})
    return {"raffleResults": raffle_results, "clears": clears, "warnings": warnings, "errors": errors}
