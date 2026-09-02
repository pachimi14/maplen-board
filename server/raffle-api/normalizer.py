from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from contracts import CreateJobRequest


SCHEMA_VERSION = 3
CLASSIFICATION_VERSION = 4
TARGET_BOSSES = {"Lucid": "LUCID", "Will": "WILL", "Guardian Angel Slime": "SLIME"}
TARGET_COINS = {"LUCID": "Phantasma Coin", "WILL": "Arachno Coin"}
FT_ITEM_NAME = "Sealed Mirror World Nodestone"
ASCENDANT_TIER_BY_BOSS = {
    ("LUCID", "DIFFICULTY_EASY"): "Dawning Ascendant 2",
    ("LUCID", "DIFFICULTY_NORMAL"): "Mystic Ascendant",
    ("LUCID", "DIFFICULTY_HARD"): "Divine Ascendant",
    ("WILL", "DIFFICULTY_EASY"): "Luminous Ascendant",
    ("WILL", "DIFFICULTY_NORMAL"): "Glorious Ascendant",
    # docs/IMPL_PLAN_RAFFLE_CHAOS_SLIME.md follow-up (statement-level orchestrator ruling,
    # 2026-09-03): was "Eternal Ascendant" -- a bare *prefix* of the real layer name
    # "Eternal Ascendant Chaos Guardian" (confirmed against production data). A member without
    # their own "Eternal Ascendant Hard Will" layer (e.g. they only ever cleared Chaos
    # Guardian's Ascendant) left exactly one prefix-matching candidate, which
    # `_ascendant_for_boss`'s single-candidate fallback then returned -- silently misattributing
    # the Chaos Guardian Ascendant's NESO/Power Crystal to a Hard Will clear. Verified real
    # value below closes this by matching exactly instead of by prefix.
    ("WILL", "DIFFICULTY_HARD"): "Eternal Ascendant Hard Will",
    # docs/IMPL_PLAN_RAFFLE_CHAOS_SLIME.md: only the Chaos difficulty of Guardian Angel Slime is
    # a distribution target (LULU-141 user ruling). Normal Guardian Angel Slime
    # (DIFFICULTY_NORMAL) is deliberately absent -- an absent table entry makes
    # `_boss_distribution_context` return None, so it never becomes a clear candidate.
    ("SLIME", "DIFFICULTY_CHAOS"): "Eternal Ascendant Chaos Guardian",
}
BOSS_DIFFICULTIES = {"DIFFICULTY_EASY": "EASY", "DIFFICULTY_NORMAL": "NORMAL", "DIFFICULTY_HARD": "HARD", "DIFFICULTY_CHAOS": "CHAOS"}
CLEAR_CLUSTER_WINDOW = timedelta(hours=1)
POWER_CRYSTAL_PATTERN = re.compile(
    r"^(?P<amount>\d+)(?P<suffix>[KM]?) Power Crystal Coupon$", re.IGNORECASE
)
# docs/IMPL_PLAN_RAFFLE_REWARD_VOCAB.md S1: the official API switched Power Crystal from a
# coupon item (name-pattern, resolved via metadata) to a direct-amount item at this fixed
# itemId (quantity IS the Power Crystal amount, face value 1). Metadata for it 404s, same as
# NESO's itemId 1 -- both are currency-like IDs with no item metadata entry.
POWER_CRYSTAL_DIRECT_ITEM_ID = 1000
RING_BOX_NAME_SUFFIX = "Ring Box"

def _drops(boss: str, member_index: int) -> list[dict]:
    drops = []
    if member_index == 0:
        drops.append({"dropId": f"fixture-{boss.lower()}-coin", "category": "COIN", "name": "Phantasma Coin" if boss == "LUCID" else "Arachno Coin", "quantity": "10"})
    if member_index == 1:
        drops.append({"dropId": f"fixture-{boss.lower()}-equipment", "category": "EQUIPMENT", "name": f"Fixture {boss.title()} Equipment", "quantity": "1"})
    return drops


def _slime_drops(member_index: int) -> list[dict]:
    # docs/IMPL_PLAN_RAFFLE_CHAOS_SLIME.md S3: unlike Lucid/Will, Slime has no coin -- the only
    # fixture drop is a Ring Box (EQUIPMENT), kept at member index 1 to mirror where `_drops`
    # places the Lucid/Will equipment drop.
    if member_index == 1:
        return [{"dropId": "fixture-slime-equipment", "category": "EQUIPMENT", "name": "Fixture Slime Ring Box", "quantity": "1"}]
    return []


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
        difficulty, ascendant_tier = ("HARD", "Divine Ascendant") if boss == "LUCID" else ("HARD", "Eternal Ascendant Hard Will")
        members = []
        for index, character in enumerate(request.characters):
            members.append({"memberId": character.memberId, "bossNeso": "600" if index == 0 else "0", "powerCrystalAmount": "100" if index == 0 else "0", "ascendantNeso": "50" if index == 0 else "0", "drops": _drops(boss, index)})
        clears.append({"clearId": "fixture-" + boss.lower(), "boss": boss, "bossDifficulty": difficulty, "ascendantTier": ascendant_tier, "partyCount": len(request.characters), "historyMemberIds": [character.memberId for character in request.characters], "complete": True, "members": members, "excludedRewards": []})
    # docs/IMPL_PLAN_RAFFLE_CHAOS_SLIME.md S3: Slime has no coin and no Power Crystal in
    # production -- kept at 0 here too, so fixture (dev/CI) mode preserves that shape instead of
    # inventing amounts the real boss never grants.
    slime_members = []
    for index, character in enumerate(request.characters):
        slime_members.append({"memberId": character.memberId, "bossNeso": "0", "powerCrystalAmount": "0", "ascendantNeso": "50" if index == 0 else "0", "drops": _slime_drops(index)})
    clears.append({"clearId": "fixture-slime", "boss": "SLIME", "bossDifficulty": "CHAOS", "ascendantTier": "Eternal Ascendant Chaos Guardian", "partyCount": len(request.characters), "historyMemberIds": [character.memberId for character in request.characters], "complete": True, "members": slime_members, "excludedRewards": []})
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
    if item_id == POWER_CRYSTAL_DIRECT_ITEM_ID:
        return "POWER_CRYSTAL", "Power Crystal"
    name = _text((metadata or {}).get("itemName")) or f"Item {item_id}"
    if name in TARGET_COINS.values() and _text((metadata or {}).get("tier1")) == "Exchange Currency":
        return "COIN", name
    if POWER_CRYSTAL_PATTERN.fullmatch(name):
        return "POWER_CRYSTAL", name
    if name == FT_ITEM_NAME:
        return "FT_ITEM", name
    # docs/IMPL_PLAN_RAFFLE_REWARD_VOCAB.md S2: Rank N Special Skill Ring Box (tier1=Voucher,
    # like Sealed Mirror World Nodestone) is sellable gear-adjacent loot, not a raffle currency
    # -- treated as EQUIPMENT so it gets a sale-price input like other drops. Suffix match (not
    # a literal name list) so a future "Rank 8 ..." tier keeps working without a code change
    # (LULU-130 lesson: exact-name matching alone breaks on upstream vocabulary growth).
    if _text((metadata or {}).get("tier1")) == "Voucher" and name.endswith(RING_BOX_NAME_SUFFIX):
        return "EQUIPMENT", name
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


def _power_crystal_amount(prize: dict, metadata: dict | None) -> int:
    """docs/IMPL_PLAN_RAFFLE_REWARD_VOCAB.md S1: resolves a single prize's Power Crystal
    contribution under either vocabulary the official API has used. `itemId 1000` is a direct
    grant -- the prize's quantity IS the Power Crystal amount (face value 1, no metadata
    needed/available). The older `"<N>[K|M] Power Crystal Coupon"` name pattern is still
    honored so past rounds (already-settled coupon-style history) keep recalculating the same
    way (no regression)."""
    item_id = _item_id(prize)
    quantity = _quantity(prize)
    if item_id == POWER_CRYSTAL_DIRECT_ITEM_ID:
        return quantity
    return quantity * _power_crystal_face_value(metadata)


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


def _one_hour_party_clusters(
    member_histories: dict[str, list[tuple[dict, datetime, int]]],
    expected_party_count: int,
) -> tuple[list[tuple[dict[str, tuple[dict, int]], datetime]], bool]:
    """Greedy-partitions every history record matching `expected_party_count` into
    one-hour-window clusters (docs/IMPL_PLAN_RAFFLE_MULTI_CLEAR.md S1). Unlike the
    single-cluster predecessor this fully floats a member's repeated clears at the
    same official party size: each is kept (no longer dropped outright) and only
    excluded from a cluster it would collide with (two records for the same member
    inside the same one-hour window), which is the one case still flagged via the
    returned `ambiguous` bool. Disjoint same-size groups (e.g. two independent
    6-person parties) are no longer forced to tie-break away; every non-conflicting
    cluster is returned as its own independent candidate.
    """
    records: list[tuple[datetime, str, dict, int]] = []
    for member_id, values in member_histories.items():
        for history, cleared_at, party_count in values:
            if party_count == expected_party_count:
                records.append((cleared_at, member_id, history, party_count))
    records.sort(key=lambda value: value[0])

    assigned = [False] * len(records)
    ambiguous = False
    clusters: list[list[tuple[datetime, str, dict, int]]] = []
    for seed_index in range(len(records)):
        if assigned[seed_index]:
            continue
        seed_time = records[seed_index][0]
        cluster_member_ids = {records[seed_index][1]}
        cluster = [records[seed_index]]
        assigned[seed_index] = True
        for candidate_index in range(seed_index + 1, len(records)):
            if assigned[candidate_index]:
                continue
            cleared_at, member_id, _history, _party_count = records[candidate_index]
            if cleared_at - seed_time > CLEAR_CLUSTER_WINDOW:
                break
            if member_id in cluster_member_ids:
                # Same member has a second clear for this official party size inside
                # this cluster's one-hour window: which one belongs here is
                # genuinely ambiguous, so it is left out (and left unassigned --
                # it may still form its own cluster later if it doesn't collide
                # with anything else).
                ambiguous = True
                continue
            cluster_member_ids.add(member_id)
            cluster.append(records[candidate_index])
            assigned[candidate_index] = True
        if len(cluster) > expected_party_count:
            # Cannot exceed the official party size; discard as unresolved.
            continue
        clusters.append(cluster)
    return [
        (
            {member_id: (history, party_count) for _cleared_at, member_id, history, party_count in cluster},
            cluster[0][0],
        )
        for cluster in clusters
    ], ambiguous


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
        # docs/IMPL_PLAN_RAFFLE_CHAOS_SLIME.md follow-up (statement-level orchestrator ruling,
        # 2026-09-03, real-data regression): a configured tier that is a bare *prefix* of
        # another boss/difficulty's own configured tier must never resolve via a layer that IS
        # that other entry's exact tier -- excluded from the prefix candidate pool outright.
        # Without this, a member missing their own Ascendant history (e.g. they only ever
        # cleared Chaos Guardian, never Hard Will) left exactly one prefix-matching candidate
        # (the OTHER boss's Ascendant), which was then silently misattributed -- confirmed
        # against production data (a Chaos Guardian Ascendant NESO win double-counted onto a
        # Hard Will clear). If this empties the candidate pool, resolution fails visibly
        # (`ascendant_not_found`, below) instead of guessing.
        other_target_tiers_cf = {tier.casefold() for tier in ASCENDANT_TIER_BY_BOSS.values() if tier.casefold() != target_tier_cf}
        prefix = [
            (name, history) for name, history in candidates
            if name.casefold().startswith(target_tier_cf) and name.casefold() not in other_target_tiers_cf
        ]
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


def _reward_outcome(prize: dict, coin_name: str, boss_code: str, item_metadata: dict[int, dict]) -> tuple[str, str, int, str] | None:
    """Classifies a single prize (from either the boss's own history or its Ascendant-tier
    history -- LULU-141 follow-up, orchestrator ruling 2026-09-03) into a settlement outcome:
    `(kind, name, quantity, imageUrl)`, `kind` one of "coin_match" / "coin_other" /
    "equipment" / "ft_item" / "other". Returns `None` for a zero-quantity prize, or one this
    function never settles at all (NESO, Power Crystal -- summed by the caller separately from
    both histories; a non-Will FT_ITEM). Callers of this function are responsible for excluding
    NESO/Power-Crystal-classified prizes from an Ascendant history *before* calling it, so
    their amounts are not double-counted on top of the caller's own separate summation."""
    quantity = _quantity(prize)
    if quantity <= 0:
        return None
    item_id = _item_id(prize)
    classification, name = _classification(item_id, item_metadata.get(item_id))
    image_url = _item_icon_url(item_metadata.get(item_id))
    if classification == "COIN":
        return ("coin_match" if name == coin_name else "coin_other", name, quantity, image_url)
    if classification == "EQUIPMENT":
        return ("equipment", name, quantity, image_url)
    if classification == "FT_ITEM":
        # Only surfaced for Will clears (Lucid/Slime never roll this item); the affiliate is
        # asked for a resale price like coin/equipment so it can be settled the same way.
        return ("ft_item", name, quantity, image_url) if boss_code == "WILL" else None
    if classification == "OTHER":
        return ("other", name, quantity, image_url)
    return None


def _member_settlement(member_id: str, boss_code: str, history: dict, ascendant: dict | None, item_metadata: dict[int, dict], drop_scope: str = "") -> dict:
    drops = []
    excluded_rewards: list[tuple[str, int]] = []
    drop_prefix = boss_code.lower() + ("-" + drop_scope if drop_scope else "") + "-" + member_id
    # docs/IMPL_PLAN_RAFFLE_CHAOS_SLIME.md S2: not every distribution-target boss has a coin
    # (SLIME does not), so this is `.get(..., "")` rather than a `[...]` lookup that would raise
    # KeyError. `coin_name == ""` never equals a real reward name, so `_reward_outcome` always
    # resolves to "coin_other" (fail-visible in excludedRewards) for such a boss.
    coin_name = TARGET_COINS.get(boss_code, "")
    coin_quantity = 0
    coin_image_url = ""

    def _apply(prizes: list[dict], drop_id_segment: str) -> None:
        # docs/IMPL_PLAN_RAFFLE_CHAOS_SLIME.md follow-up (LULU-141 orchestrator ruling,
        # 2026-09-03): applied to both the boss's own history (drop_id_segment="") and its
        # Ascendant-tier history (drop_id_segment="ascendant-"). The segment keeps every
        # generated dropId unique within a clear (a boss-layer Ring Box and an
        # Ascendant-layer Ring Box for the same member can never collide), which matters
        # because the web side keys its per-drop sale-price input by dropId -- a collision
        # would let one drop's sale price silently overwrite the other's.
        nonlocal coin_quantity, coin_image_url
        equipment_index = 0
        ft_item_index = 0
        for prize in prizes:
            outcome = _reward_outcome(prize, coin_name, boss_code, item_metadata)
            if outcome is None:
                continue
            kind, name, quantity, image_url = outcome
            if kind == "coin_match":
                coin_quantity += quantity
                coin_image_url = coin_image_url or image_url
            elif kind == "equipment":
                equipment_index += 1
                drops.append({"dropId": f"{drop_prefix}-{drop_id_segment}equipment-{equipment_index}", "category": "EQUIPMENT", "name": name, "quantity": str(quantity), "imageUrl": image_url})
            elif kind == "ft_item":
                ft_item_index += 1
                drops.append({"dropId": f"{drop_prefix}-{drop_id_segment}ftitem-{ft_item_index}", "category": "FT_ITEM", "name": name, "quantity": str(quantity), "imageUrl": image_url})
            else:
                # "coin_other" (docs/IMPL_PLAN_RAFFLE_CHAOS_SLIME.md S2) and "other"
                # (docs/IMPL_PLAN_RAFFLE_REWARD_VOCAB.md S3): a reward that falls out of every
                # distributable category used to vanish silently (LULU-119/130's failure
                # class). Surfaced instead of dropped, so the next vocabulary drift -- or an
                # Ascendant-layer prize this loop previously never even looked at -- is visible
                # in the UI, not just in a stale payout total.
                excluded_rewards.append((name, quantity))

    _apply(_prizes(history), "")

    power_crystal = 0
    ascendant_other_prizes = []
    for prize in _prizes(ascendant or {}):
        item_id = _item_id(prize)
        if item_id == 1:
            continue  # NESO -- summed separately via `_sum_item(ascendant, 1)` below.
        classification, _name = _classification(item_id, item_metadata.get(item_id))
        if classification == "POWER_CRYSTAL":
            power_crystal += _power_crystal_amount(prize, item_metadata.get(item_id))
            continue
        ascendant_other_prizes.append(prize)
    _apply(ascendant_other_prizes, "ascendant-")

    if coin_quantity:
        drops.insert(0, {"dropId": f"{drop_prefix}-coin", "category": "COIN", "name": coin_name, "quantity": str(coin_quantity), "imageUrl": coin_image_url})
    return {"memberId": member_id, "bossNeso": str(_sum_item(history, 1)), "powerCrystalAmount": str(power_crystal), "ascendantNeso": str(_sum_item(ascendant, 1)), "drops": drops, "excludedRewards": excluded_rewards}


def _empty_member_settlement(member_id: str) -> dict:
    return {"memberId": member_id, "bossNeso": "0", "powerCrystalAmount": "0", "ascendantNeso": "0", "drops": [], "excludedRewards": []}


def _clear_excluded_rewards(members: list[dict]) -> list[dict]:
    """Aggregates each member's excludedRewards (S3) into one same-name-summed list for the
    whole clear, then strips the internal-only per-member field back off `members` so it never
    leaks into the payload's member objects (the field belongs on the clear, not the member)."""
    totals: dict[str, int] = {}
    order: list[str] = []
    for member in members:
        for name, quantity in member.pop("excludedRewards", []):
            if name not in totals:
                order.append(name)
            totals[name] = totals.get(name, 0) + quantity
    return [{"name": name, "quantity": str(totals[name])} for name in order]


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
    difficulty_order = {"CHAOS": 0, "HARD": 1, "NORMAL": 2, "EASY": 3}
    for boss_code in ("LUCID", "WILL", "SLIME"):
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
                clusters, ambiguous = _one_hour_party_clusters(member_histories, official_party_count)
                if ambiguous:
                    warnings.append({"code": "ambiguous_party_cluster", "boss": boss_code, "bossDifficulty": difficulty, "partyCount": official_party_count})
                for cluster_index, (cluster, cluster_cleared_at) in enumerate(clusters, start=1):
                    members = []
                    history_member_ids = []
                    missing_ascendant_tier = None
                    for character in request.characters:
                        match = cluster.get(character.memberId)
                        if match is not None:
                            history, _party_count = match
                            ascendant, missing_tier = _ascendant_for_boss(exact_histories.get(character.memberId, []), layers_by_id, history)
                            missing_ascendant_tier = missing_ascendant_tier or missing_tier
                            members.append(_member_settlement(character.memberId, boss_code, history, ascendant, item_metadata, difficulty.lower()))
                            history_member_ids.append(character.memberId)
                        else:
                            members.append(_empty_member_settlement(character.memberId))
                    if missing_ascendant_tier:
                        # Fail-visible instead of a silent 0 (LULU-119 principle): tell the
                        # caller Power Crystal/Ascendant NESO could not be resolved for this
                        # clear rather than only surfacing zeroed amounts.
                        warnings.append({"code": "ascendant_not_found", "boss": boss_code, "bossDifficulty": difficulty, "expectedTier": missing_ascendant_tier})
                    clears.append({
                        # Index disambiguates independent same-partyCount clusters (S1):
                        # every cluster gets its own clearId, even when there is only one.
                        "clearId": f"clear-{boss_code.lower()}-{difficulty.lower()}-p{official_party_count}-{cluster_index}",
                        "boss": boss_code,
                        "bossDifficulty": difficulty,
                        "ascendantTier": ascendant_tier,
                        "partyCount": official_party_count,
                        "historyMemberIds": history_member_ids,
                        "complete": True,
                        "members": members,
                        "clearedAt": cluster_cleared_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                        "excludedRewards": _clear_excluded_rewards(members),
                    })
    return {"raffleResults": raffle_results, "clears": clears, "warnings": warnings, "errors": errors}
