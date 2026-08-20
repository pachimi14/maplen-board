from __future__ import annotations

import json
from pathlib import Path

import pytest

from normalizer import ASCENDANT_TIER_BY_BOSS, TARGET_BOSSES, _ascendant_for_boss, normalize_live_history
from contracts import CreateJobRequest

# Real-layer-name regression guard (docs/IMPL_PLAN_RAFFLE_ASCENDANT_MATCH.md).
#
# The fixture is a machine snapshot of the official Ascendant `contents.layerName`
# vocabulary actually observed in production (10 entries). It is intentionally NOT
# hand-authored so that `_ascendant_for_boss` regressions against the real layer-name
# vocabulary are caught even when synthetic unit-test fixtures stay green -- this is the
# same class of defect as LULU-119 (external vocabulary vs. code-side expectations going
# unchecked), just for Ascendant layer names instead of item tier0/tier1.
BOSS_CODE_TO_DISPLAY_NAME = {code: name for name, code in TARGET_BOSSES.items()}


def _load_layer_names() -> list[str]:
    root = Path(__file__).resolve().parents[3]
    path = root / "testdata" / "raffle" / "v1" / "ascendant-layers.json"
    return json.loads(path.read_text(encoding="utf-8"))["ascendantLayerNames"]


LAYER_NAMES = _load_layer_names()


def _synthetic_layers_and_histories(layer_names: list[str]) -> tuple[dict[str, dict], list[dict]]:
    layers_by_id: dict[str, dict] = {}
    histories: list[dict] = []
    for index, layer_name in enumerate(layer_names):
        layer_id = f"ascendant-{index}"
        layers_by_id[layer_id] = {"contents": {"groupName": "Ascendant Tier Raffle", "layerName": layer_name}}
        histories.append({"layerId": layer_id, "raffledAt": "2026-08-20T00:00:00Z", "prizes": []})
    return layers_by_id, histories


def test_vocabulary_fixture_has_expected_size() -> None:
    assert len(LAYER_NAMES) == 10


@pytest.mark.parametrize(("boss_code", "raw_difficulty"), list(ASCENDANT_TIER_BY_BOSS.keys()))
def test_every_tier_table_entry_resolves_uniquely_against_the_real_layer_vocabulary(
    boss_code: str, raw_difficulty: str
) -> None:
    layers_by_id, histories = _synthetic_layers_and_histories(LAYER_NAMES)
    boss_layer_id = "boss-under-test"
    layers_by_id[boss_layer_id] = {"boss": {"bossName": BOSS_CODE_TO_DISPLAY_NAME[boss_code], "difficulty": raw_difficulty}}
    boss_history = {"layerId": boss_layer_id}

    ascendant, missing_tier = _ascendant_for_boss(histories, layers_by_id, boss_history)

    expected_tier = ASCENDANT_TIER_BY_BOSS[(boss_code, raw_difficulty)]
    assert missing_tier is None, f"{boss_code}/{raw_difficulty} (expected tier {expected_tier!r}) did not resolve uniquely against the real layer vocabulary"
    assert ascendant is not None


def test_hard_will_clear_selects_hard_will_ascendant_not_chaos_guardian() -> None:
    # Regression fixed for LULU-1xx: the Eternal tier was split into
    # "Eternal Ascendant Hard Will" and "Eternal Ascendant Chaos Guardian" per boss. A Hard
    # Will clear must resolve to the Hard Will variant, never the Chaos Guardian one.
    layers_by_id, histories = _synthetic_layers_and_histories(LAYER_NAMES)
    boss_layer_id = "boss-under-test"
    layers_by_id[boss_layer_id] = {"boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD"}}
    boss_history = {"layerId": boss_layer_id}

    ascendant, missing_tier = _ascendant_for_boss(histories, layers_by_id, boss_history)

    assert missing_tier is None
    resolved_layer = layers_by_id[ascendant["layerId"]]
    assert resolved_layer["contents"]["layerName"] == "Eternal Ascendant Hard Will"


def test_unresolvable_ascendant_tier_raises_a_visible_warning_instead_of_a_silent_zero() -> None:
    request = CreateJobRequest.model_validate({
        "raffledAt": "2026-08-20T00:00:00Z",
        "characters": [{"memberId": "m1", "assetKey": "CHARfixture001"}],
    })
    histories = {
        "m1": [{
            "raffledAt": request.raffledAt,
            "layerId": 205044,
            "clearInformations": [{"clearedAt": "2026-08-20T14:00:00Z", "partyCount": 1}],
            "prizes": [{"itemId": 1, "winCount": {"value": "100"}}],
        }],
    }
    # No Ascendant-tier history at all: the target tier ("Eternal Ascendant") can never
    # resolve, so this must surface as a warning rather than a silently-zeroed reward.
    layers = [{"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}}]

    result = normalize_live_history(request, histories, layers, {})

    clear = result["clears"][0]
    assert clear["members"][0]["powerCrystalAmount"] == "0"
    assert clear["members"][0]["ascendantNeso"] == "0"
    assert {"code": "ascendant_not_found", "boss": "WILL", "bossDifficulty": "HARD", "expectedTier": "Eternal Ascendant"} in result["warnings"]
