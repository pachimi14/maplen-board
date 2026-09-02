from __future__ import annotations

import json
from pathlib import Path

import pytest

from contracts import CreateJobRequest
from normalizer import _boss_distribution_context, _classification, fixture_result, normalize_live_history


def request_for(*member_ids: str) -> CreateJobRequest:
    return CreateJobRequest.model_validate({"raffledAt": "2026-07-30T00:00:00Z", "characters": [{"memberId": member_id, "assetKey": "CHARfixture" + str(index + 1).zfill(3)} for index, member_id in enumerate(member_ids)]})


def test_fixture_result_keeps_all_visible_results_but_scopes_settlement_clear() -> None:
    result = fixture_result(request_for("m1"))
    assert {clear["boss"] for clear in result["clears"]} == {"LUCID", "WILL", "SLIME"}
    lucid = result["clears"][0]
    assert lucid["bossDifficulty"] == "HARD"
    assert lucid["ascendantTier"] == "Divine Ascendant"
    assert lucid["members"][0]["bossNeso"] == "600"
    assert lucid["members"][0]["drops"][0]["category"] == "COIN"
    assert {entry["bossName"] for entry in result["raffleResults"]} == {"Lucid", "Will", "Other Boss"}
    slime = next(clear for clear in result["clears"] if clear["boss"] == "SLIME")
    assert slime["bossDifficulty"] == "CHAOS"
    assert slime["ascendantTier"] == "Eternal Ascendant Chaos Guardian"
    assert slime["members"][0]["bossNeso"] == "0"
    assert slime["members"][0]["powerCrystalAmount"] == "0"


@pytest.mark.parametrize(
    ("boss_name", "difficulty", "expected"),
    [
        ("Lucid", "DIFFICULTY_EASY", ("EASY", "Dawning Ascendant 2")),
        ("Lucid", "DIFFICULTY_NORMAL", ("NORMAL", "Mystic Ascendant")),
        ("Lucid", "DIFFICULTY_HARD", ("HARD", "Divine Ascendant")),
        ("Will", "DIFFICULTY_EASY", ("EASY", "Luminous Ascendant")),
        ("Will", "DIFFICULTY_NORMAL", ("NORMAL", "Glorious Ascendant")),
        ("Will", "DIFFICULTY_HARD", ("HARD", "Eternal Ascendant")),
    ],
)
def test_all_distributable_boss_difficulties_map_to_ascendant_tiers(
    boss_name: str, difficulty: str, expected: tuple[str, str]
) -> None:
    layer = {"boss": {"bossName": boss_name, "difficulty": difficulty}}
    assert _boss_distribution_context(layer) == expected

def test_live_normalization_displays_all_wins_and_builds_only_complete_lucid_clear() -> None:
    request = request_for("m1", "m2")
    raffle_at = request.raffledAt
    clear_time = "2026-07-25T11:35:31.620Z"
    ascendant_time = "2026-07-25T11:35:31.633333333Z"

    def lucid(prizes):
        return {"raffledAt": raffle_at, "layerId": 205041, "clearInformations": [{"clearedAt": clear_time, "partyCount": 2}], "prizes": prizes}

    def ascendant(prizes):
        return {"raffledAt": raffle_at, "layerId": 900001, "clearInformations": [{"clearedAt": ascendant_time, "partyCount": 2}], "prizes": prizes}

    histories = {
        "m1": [
            lucid([{"rewardKey": {"itemId": 1}, "winCount": {"value": "9000000.000000"}}, {"rewardKey": {"itemId": 4310218}, "winCount": {"value": "4.000000"}}, {"rewardKey": {"itemId": 1001000}, "winCount": {"value": "1.000000"}}]),
            ascendant([{"rewardKey": {"itemId": 1}, "winCount": {"value": "12000000.000000"}}, {"rewardKey": {"itemId": 2832960}, "winCount": {"value": "6.000000"}}]),
            {"raffledAt": raffle_at, "layerId": 300001, "clearInformations": [{"clearedAt": "2026-07-26T00:00:00Z", "partyCount": 1}], "prizes": [{"itemId": 999, "winCount": {"value": "2"}}]},
            {"raffledAt": "2026-07-31T00:00:00Z", "layerId": 300001, "prizes": [{"itemId": 999, "winCount": {"value": "99"}}]},
        ],
        "m2": [lucid([]), ascendant([])],
    }
    layers = [
        {"layerId": 205041, "boss": {"bossName": "Lucid", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Lucid"}},
        {"layerId": 900001, "contents": {"groupName": "Divine Ascendant", "layerName": "Divine Ascendant"}},
        {"layerId": 300001, "boss": {"bossName": "Lotus", "raffleLayerName": "Hard Lotus"}},
    ]
    metadata = {
        4310218: {"itemName": "Phantasma Coin", "tier1": "Exchange Currency", "imageUrl": "https://api-static.msu.io/itemimages/icon/4310218.png"},
        1001000: {"itemName": "Arcane Test Hat", "tier0": "Item", "tier1": "Armor", "imageUrl": "https://api-static.msu.io/itemimages/icon/1001000.png"},
        2832960: {"itemName": "1M Power Crystal Coupon"},
        999: {"itemName": "Other Reward", "tier0": "Etc"},
    }
    result = normalize_live_history(request, histories, layers, metadata)
    assert {entry["bossName"] for entry in result["raffleResults"]} >= {"Lucid", "Lotus", "Divine Ascendant"}
    assert all(entry["raffledAt"] == raffle_at for entry in result["raffleResults"])
    assert [clear["boss"] for clear in result["clears"]] == ["LUCID"]
    lucid_clear = result["clears"][0]
    assert lucid_clear["bossDifficulty"] == "HARD"
    assert lucid_clear["ascendantTier"] == "Divine Ascendant"
    first = lucid_clear["members"][0]
    assert first["bossNeso"] == "9000000"
    assert first["ascendantNeso"] == "12000000"
    assert first["powerCrystalAmount"] == "6000000"
    assert {(drop["category"], drop["name"], drop["quantity"]) for drop in first["drops"]} == {("COIN", "Phantasma Coin", "4"), ("EQUIPMENT", "Arcane Test Hat", "1")}
    equipment_drop = next(drop for drop in first["drops"] if drop["category"] == "EQUIPMENT")
    assert equipment_drop["imageUrl"] == "https://api-static.msu.io/itemimages/icon/1001000.png"
    coin_reward = next(reward for entry in result["raffleResults"] for reward in entry["rewards"] if reward["rewardName"] == "Phantasma Coin")
    assert coin_reward["iconUrl"] == "https://api-static.msu.io/itemimages/icon/4310218.png"


def test_normal_will_uses_glorious_ascendant_without_clear_information() -> None:
    request = request_for("m1")
    histories = {
        "m1": [
            {
                "raffledAt": request.raffledAt,
                "layerId": 205043,
                "clearInformations": [{"clearedAt": "2026-07-26T06:59:16Z", "partyCount": 1}],
                "prizes": [{"itemId": 1, "winCount": {"value": "8100000"}}],
            },
            {
                "raffledAt": request.raffledAt,
                "layerId": 308058,
                "clearInformations": [],
                "prizes": [
                    {"itemId": 1, "winCount": {"value": "8000000"}},
                    {"itemId": 2832960, "winCount": {"value": "6"}},
                ],
            },
            {
                "raffledAt": request.raffledAt,
                "layerId": 308059,
                "clearInformations": [],
                "prizes": [{"itemId": 1, "winCount": {"value": "999000000"}}],
            },
        ]
    }
    layers = [
        {"layerId": 205043, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_NORMAL", "raffleLayerName": "[Normal] Will"}},
        {"layerId": 308058, "contents": {"groupName": "Ascendant Tier Raffle", "layerName": "Glorious Ascendant"}},
        {"layerId": 308059, "contents": {"groupName": "Ascendant Tier Raffle", "layerName": "Divine Ascendant"}},
    ]
    metadata = {2832960: {"itemName": "1M Power Crystal Coupon"}}

    result = normalize_live_history(request, histories, layers, metadata)

    assert len(result["clears"]) == 1
    assert result["clears"][0]["bossDifficulty"] == "NORMAL"
    assert result["clears"][0]["ascendantTier"] == "Glorious Ascendant"
    member = result["clears"][0]["members"][0]
    assert member["bossNeso"] == "8100000"
    assert member["ascendantNeso"] == "8000000"
    assert member["powerCrystalAmount"] == "6000000"

def test_hard_will_resolves_power_crystal_and_ascendant_neso_via_renamed_eternal_layer() -> None:
    # Regression for docs/IMPL_PLAN_RAFFLE_ASCENDANT_MATCH.md: the official API renamed the
    # single "Eternal Ascendant" layer to "Eternal Ascendant Hard Will" / "Eternal Ascendant
    # Chaos Guardian" (split per boss), which broke exact-match resolution and silently zeroed
    # Power Crystal / Ascendant NESO for every Hard Will clear. Both variants are present here
    # to also prove the Hard Will clear selects its own variant, not the Chaos Guardian one.
    request = request_for("m1")
    histories = {
        "m1": [
            {
                "raffledAt": request.raffledAt,
                "layerId": 205044,
                "clearInformations": [{"clearedAt": "2026-08-20T14:00:00Z", "partyCount": 1}],
                "prizes": [{"itemId": 1, "winCount": {"value": "3000000"}}],
            },
            {
                "raffledAt": request.raffledAt,
                "layerId": 900101,
                "clearInformations": [],
                "prizes": [
                    {"itemId": 1, "winCount": {"value": "3000000"}},
                    {"itemId": 2832960, "winCount": {"value": "6"}},
                ],
            },
            {
                "raffledAt": request.raffledAt,
                "layerId": 900102,
                "clearInformations": [],
                "prizes": [{"itemId": 1, "winCount": {"value": "999000000"}}],
            },
        ]
    }
    layers = [
        {"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}},
        {"layerId": 900101, "contents": {"groupName": "Ascendant Tier Raffle", "layerName": "Eternal Ascendant Hard Will"}},
        {"layerId": 900102, "contents": {"groupName": "Ascendant Tier Raffle", "layerName": "Eternal Ascendant Chaos Guardian"}},
    ]
    metadata = {2832960: {"itemName": "1M Power Crystal Coupon"}}

    result = normalize_live_history(request, histories, layers, metadata)

    assert len(result["clears"]) == 1
    assert result["clears"][0]["ascendantTier"] == "Eternal Ascendant"
    member = result["clears"][0]["members"][0]
    assert member["ascendantNeso"] == "3000000"
    assert member["powerCrystalAmount"] == "6000000"
    assert not [warning for warning in result["warnings"] if warning["code"] == "ascendant_not_found"]


def test_six_person_roster_accepts_four_history_members_within_one_hour() -> None:
    member_ids = tuple(f"m{index}" for index in range(1, 7))
    request = request_for(*member_ids)
    clear_times = [
        "2026-07-23T14:44:32.793333333Z",
        "2026-07-23T14:46:17.000000000Z",
        "2026-07-23T14:46:27.926666666Z",
        "2026-07-23T14:47:07.436666666Z",
    ]
    histories = {
        member_id: [{
            "raffledAt": request.raffledAt,
            "layerId": 205044,
            "clearInformations": [{"clearedAt": clear_times[index], "partyCount": 6}],
            "prizes": [{"itemId": 1, "winCount": {"value": "100"}}],
        }]
        for index, member_id in enumerate(member_ids[:4])
    }
    layers = [{"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}}]

    clears = normalize_live_history(request, histories, layers, {})["clears"]

    assert len(clears) == 1
    clear = clears[0]
    assert clear["boss"] == "WILL"
    assert clear["partyCount"] == 6
    assert clear["historyMemberIds"] == ["m1", "m2", "m3", "m4"]
    assert [member["memberId"] for member in clear["members"]] == list(member_ids)
    assert [member["bossNeso"] for member in clear["members"]] == ["100", "100", "100", "100", "0", "0"]


def test_exactly_one_hour_apart_is_the_same_party() -> None:
    request = request_for("m1", "m2")
    histories = {
        "m1": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T14:00:00Z", "partyCount": 2}], "prizes": []}],
        "m2": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T15:00:00Z", "partyCount": 2}], "prizes": []}],
    }
    layers = [{"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}}]

    assert len(normalize_live_history(request, histories, layers, {})["clears"]) == 1


def test_more_than_one_hour_apart_is_not_the_same_party() -> None:
    # docs/IMPL_PLAN_RAFFLE_MULTI_CLEAR.md S1 (failure mode B fix): m1 and m2 are not
    # the same party (more than an hour apart), so they no longer tie-break each
    # other away -- each becomes its own independent one-member candidate instead of
    # the whole partyCount being silently dropped.
    request = request_for("m1", "m2")
    histories = {
        "m1": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T14:00:00Z", "partyCount": 2}], "prizes": []}],
        "m2": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T15:00:00.001Z", "partyCount": 2}], "prizes": []}],
    }
    layers = [{"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}}]

    clears = normalize_live_history(request, histories, layers, {})["clears"]
    assert [clear["historyMemberIds"] for clear in clears] == [["m1"], ["m2"]]
    assert {clear["clearId"] for clear in clears} == {"clear-will-hard-p2-1", "clear-will-hard-p2-2"}


def test_official_party_count_and_saved_distribution_roster_are_independent() -> None:
    request = request_for("m1", "m2", "m3", "m4", "m5", "m6")
    histories = {
        member_id: [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": f"2026-07-23T14:0{index}:00Z", "partyCount": 5}], "prizes": []}]
        for index, member_id in enumerate(("m1", "m2", "m3", "m4"))
    }
    layers = [{"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}}]

    clears = normalize_live_history(request, histories, layers, {})["clears"]

    assert len(clears) == 1
    assert clears[0]["partyCount"] == 5
    assert clears[0]["historyMemberIds"] == ["m1", "m2", "m3", "m4"]
    assert len(clears[0]["members"]) == 6


def test_six_clear_five_history_members_can_split_between_five_saved_members() -> None:
    member_ids = ("m1", "m2", "m3", "m4", "m5")
    request = request_for(*member_ids)
    histories = {
        member_id: [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": f"2026-07-23T14:0{index}:00Z", "partyCount": 6}], "prizes": [{"itemId": 1, "winCount": {"value": "100"}}]}]
        for index, member_id in enumerate(member_ids)
    }
    layers = [{"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}}]

    clear = normalize_live_history(request, histories, layers, {})["clears"][0]

    assert clear["partyCount"] == 6
    assert clear["historyMemberIds"] == list(member_ids)
    assert len(clear["members"]) == 5


def test_one_history_member_still_creates_an_explicit_confirmation_candidate() -> None:
    request = request_for("m1", "m2", "m3")
    histories = {"m1": [{"raffledAt": request.raffledAt, "layerId": 205041, "clearInformations": [{"clearedAt": "2026-07-25T11:35:31Z", "partyCount": 6}], "prizes": [{"itemId": 1, "winCount": {"value": "300"}}]}]}
    layers = [{"layerId": 205041, "boss": {"bossName": "Lucid", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Lucid"}}]

    clear = normalize_live_history(request, histories, layers, {})["clears"][0]

    assert clear["partyCount"] == 6
    assert clear["historyMemberIds"] == ["m1"]
    assert len(clear["members"]) == 3

def test_unrelated_lucid_times_do_not_contaminate_a_valid_will_party() -> None:
    member_ids = tuple(f"m{index}" for index in range(1, 7))
    request = request_for(*member_ids)
    histories = {}
    for index, member_id in enumerate(member_ids):
        histories[member_id] = [{
            "raffledAt": request.raffledAt,
            "layerId": 205041,
            "clearInformations": [{"clearedAt": f"2026-07-{23 + index:02d}T01:00:00Z", "partyCount": 6}],
            "prizes": [],
        }]
        if index < 4:
            histories[member_id].append({
                "raffledAt": request.raffledAt,
                "layerId": 205044,
                "clearInformations": [{"clearedAt": f"2026-07-23T14:0{index}:00Z", "partyCount": 6}],
                "prizes": [],
            })
    layers = [
        {"layerId": 205041, "boss": {"bossName": "Lucid", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Lucid"}},
        {"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}},
    ]

    clears = normalize_live_history(request, histories, layers, {})["clears"]

    # boss_code partitions clustering entirely (LUCID and WILL never share `member_histories`),
    # so the Will cluster below is unaffected by however Lucid's own six mutually-unrelated
    # (>1 day apart) single-member clears resolve. docs/IMPL_PLAN_RAFFLE_MULTI_CLEAR.md S1
    # (failure mode B fix): those six disjoint Lucid singles no longer tie-break each other
    # away -- each now correctly surfaces as its own one-member candidate instead of the whole
    # Lucid partyCount=6 being silently dropped.
    will_clears = [clear for clear in clears if clear["boss"] == "WILL"]
    lucid_clears = [clear for clear in clears if clear["boss"] == "LUCID"]
    assert [clear["historyMemberIds"] for clear in will_clears] == [["m1", "m2", "m3", "m4"]]
    assert sorted(clear["historyMemberIds"] for clear in lucid_clears) == [[f"m{index}"] for index in range(1, 7)]


def test_mixed_will_difficulties_create_separate_candidates_for_user_selection() -> None:
    member_ids = tuple(f"m{index}" for index in range(1, 7))
    request = request_for(*member_ids)
    histories = {}
    for index, member_id in enumerate(member_ids):
        layer_id = 205044 if index < 4 else 205043
        histories[member_id] = [{
            "raffledAt": request.raffledAt,
            "layerId": layer_id,
            "clearInformations": [{"clearedAt": f"2026-07-23T14:4{index}:00Z", "partyCount": 6}],
            "prizes": [{"itemId": 1, "winCount": {"value": "100"}}],
        }]
    layers = [
        {"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}},
        {"layerId": 205043, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_NORMAL", "raffleLayerName": "Normal Will"}},
    ]

    clears = normalize_live_history(request, histories, layers, {})["clears"]

    assert [(clear["bossDifficulty"], clear["ascendantTier"]) for clear in clears] == [
        ("HARD", "Eternal Ascendant"),
        ("NORMAL", "Glorious Ascendant"),
    ]
    assert clears[0]["historyMemberIds"] == ["m1", "m2", "m3", "m4"]
    assert clears[1]["historyMemberIds"] == ["m5", "m6"]
    assert all(clear["partyCount"] == 6 and len(clear["members"]) == 6 for clear in clears)


def test_five_and_six_person_hard_will_clusters_both_return_as_independent_candidates() -> None:
    # LULU-096 user scenario: A-E (5 characters) clear Hard Will as a 5-person party while F
    # (a 6th roster member) clears the same boss/difficulty separately in a 6-person party.
    # Both must surface as independent selectable candidates so their rewards can be combined
    # and split across the full 6-person saved roster.
    member_ids = tuple(f"m{index}" for index in range(1, 7))
    request = request_for(*member_ids)
    five_person_times = [f"2026-07-23T14:0{index}:00Z" for index in range(5)]
    histories = {
        member_id: [{
            "raffledAt": request.raffledAt,
            "layerId": 205044,
            "clearInformations": [{"clearedAt": five_person_times[index], "partyCount": 5}],
            "prizes": [{"itemId": 1, "winCount": {"value": "500000"}}],
        }]
        for index, member_id in enumerate(member_ids[:5])
    }
    histories["m6"] = [{
        "raffledAt": request.raffledAt,
        "layerId": 205044,
        "clearInformations": [{"clearedAt": "2026-07-23T20:00:00Z", "partyCount": 6}],
        "prizes": [{"itemId": 1, "winCount": {"value": "900000"}}],
    }]
    layers = [{"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}}]

    clears = normalize_live_history(request, histories, layers, {})["clears"]

    assert len(clears) == 2
    # docs/IMPL_PLAN_RAFFLE_MULTI_CLEAR.md S1: clearId always carries a per-cluster
    # index (even when a partyCount only resolves one cluster).
    assert {clear["clearId"] for clear in clears} == {"clear-will-hard-p5-1", "clear-will-hard-p6-1"}
    five_clear = next(clear for clear in clears if clear["partyCount"] == 5)
    six_clear = next(clear for clear in clears if clear["partyCount"] == 6)
    assert five_clear["boss"] == "WILL" and five_clear["bossDifficulty"] == "HARD"
    assert five_clear["historyMemberIds"] == ["m1", "m2", "m3", "m4", "m5"]
    assert [member["bossNeso"] for member in five_clear["members"]] == ["500000"] * 5 + ["0"]
    assert six_clear["historyMemberIds"] == ["m6"]
    assert [member["bossNeso"] for member in six_clear["members"]] == ["0"] * 5 + ["900000"]


def test_two_disjoint_same_size_groups_both_resolve_independently() -> None:
    # docs/IMPL_PLAN_RAFFLE_MULTI_CLEAR.md S1, failure mode B regression test: two disjoint
    # one-hour windows of equal size at partyCount=6 (m1+m2 vs m3+m4) used to tie-break each
    # other away entirely (both clusters silently dropped). Both must now resolve as
    # independent candidates, alongside the unrelated clean partyCount=5 candidate.
    request = request_for("m1", "m2", "m3", "m4", "m5")
    histories = {
        "m1": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T14:00:00Z", "partyCount": 6}], "prizes": []}],
        "m2": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T14:10:00Z", "partyCount": 6}], "prizes": []}],
        "m3": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T18:00:00Z", "partyCount": 6}], "prizes": []}],
        "m4": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T18:10:00Z", "partyCount": 6}], "prizes": []}],
        "m5": [],
    }
    for index, member_id in enumerate(("m1", "m2", "m5")):
        histories[member_id].append({
            "raffledAt": request.raffledAt,
            "layerId": 205044,
            "clearInformations": [{"clearedAt": f"2026-07-23T20:0{index}:00Z", "partyCount": 5}],
            "prizes": [],
        })
    layers = [{"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}}]

    result = normalize_live_history(request, histories, layers, {})
    clears = result["clears"]

    assert [clear["partyCount"] for clear in clears] == [5, 6, 6]
    assert {clear["clearId"] for clear in clears} == {"clear-will-hard-p5-1", "clear-will-hard-p6-1", "clear-will-hard-p6-2"}
    five_clear = next(clear for clear in clears if clear["partyCount"] == 5)
    six_clears = [clear for clear in clears if clear["partyCount"] == 6]
    assert five_clear["historyMemberIds"] == ["m1", "m2", "m5"]
    assert sorted(clear["historyMemberIds"] for clear in six_clears) == [["m1", "m2"], ["m3", "m4"]]
    assert five_clear["clearedAt"] == "2026-07-23T20:00:00Z"
    assert {clear["clearedAt"] for clear in six_clears} == {"2026-07-23T14:00:00Z", "2026-07-23T18:00:00Z"}
    # Two disjoint groups is a normal situation, not a conflict -- no ambiguity warning.
    # No Ascendant-tier history is fed into this fixture, so every resolved clear also raises
    # `ascendant_not_found` (fail-visible instead of a silent 0 -- see
    # docs/IMPL_PLAN_RAFFLE_ASCENDANT_MATCH.md S2).
    assert result["warnings"] == [{"code": "ascendant_not_found", "boss": "WILL", "bossDifficulty": "HARD", "expectedTier": "Eternal Ascendant"}] * 3


def test_same_member_repeating_at_the_same_party_size_appears_in_both_well_separated_clusters() -> None:
    # Acceptance criterion 2 (docs/IMPL_PLAN_RAFFLE_MULTI_CLEAR.md): m1 clears Hard Will twice
    # at partyCount=6, in two well-separated (>1 hour apart) parties. Failure mode A used to
    # drop m1 from the candidate pool entirely; m1 must now appear in both clusters.
    request = request_for("m1", "m2", "m3", "m4", "m5")
    histories = {
        "m1": [
            {"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T14:00:00Z", "partyCount": 6}]},
            {"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T20:00:00Z", "partyCount": 6}]},
        ],
        "m2": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T14:01:00Z", "partyCount": 6}]}],
        "m3": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T14:02:00Z", "partyCount": 6}]}],
        "m4": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T20:01:00Z", "partyCount": 6}]}],
        "m5": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T20:02:00Z", "partyCount": 6}]}],
    }
    for member_id in histories:
        for history in histories[member_id]:
            history["prizes"] = []
    layers = [{"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}}]

    result = normalize_live_history(request, histories, layers, {})

    assert [clear["historyMemberIds"] for clear in result["clears"]] == [["m1", "m2", "m3"], ["m1", "m4", "m5"]]
    assert not [warning for warning in result["warnings"] if warning["code"] == "ambiguous_party_cluster"]


def test_same_member_repeating_within_the_same_one_hour_window_is_ambiguous() -> None:
    # Acceptance criterion 5 (docs/IMPL_PLAN_RAFFLE_MULTI_CLEAR.md): unlike the well-separated
    # case above, m1's two partyCount=6 clears both land inside the same one-hour window here
    # (which one belongs to the m1+m2 cluster is genuinely ambiguous), so this specific
    # collision must still raise `ambiguous_party_cluster` -- while the clean m1+m2 cluster and
    # m1's own leftover single-member cluster are still both returned.
    request = request_for("m1", "m2")
    histories = {
        "m1": [
            {"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T14:00:00Z", "partyCount": 6}], "prizes": []},
            {"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T14:05:00Z", "partyCount": 6}], "prizes": []},
        ],
        "m2": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T14:02:00Z", "partyCount": 6}], "prizes": []}],
    }
    layers = [{"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}}]

    result = normalize_live_history(request, histories, layers, {})

    assert [clear["historyMemberIds"] for clear in result["clears"]] == [["m1", "m2"], ["m1"]]
    assert [warning for warning in result["warnings"] if warning["code"] == "ambiguous_party_cluster"] == [
        {"code": "ambiguous_party_cluster", "boss": "WILL", "bossDifficulty": "HARD", "partyCount": 6},
    ]


def test_four_person_group_and_two_disjoint_six_person_groups_all_resolve_as_three_candidates() -> None:
    # Acceptance criterion 1 (docs/IMPL_PLAN_RAFFLE_MULTI_CLEAR.md): the reported "4 people, 6
    # people, 6 people" scenario -- a partyCount=4 cluster plus two disjoint partyCount=6
    # clusters -- must all resolve as three independent candidates.
    request = request_for("m1", "m2", "m3", "m4", "m5", "m6")
    histories = {
        "m1": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T10:00:00Z", "partyCount": 4}], "prizes": []}],
        "m2": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T10:01:00Z", "partyCount": 4}], "prizes": []}],
        "m3": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T10:02:00Z", "partyCount": 4}], "prizes": []}] + [
            {"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T14:00:00Z", "partyCount": 6}], "prizes": []}
        ],
        "m4": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T10:03:00Z", "partyCount": 4}], "prizes": []}],
        "m5": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T20:00:00Z", "partyCount": 6}], "prizes": []}],
        "m6": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T20:01:00Z", "partyCount": 6}], "prizes": []}],
    }
    histories["m1"].append({"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T14:01:00Z", "partyCount": 6}], "prizes": []})
    layers = [{"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}}]

    clears = normalize_live_history(request, histories, layers, {})["clears"]

    assert len(clears) == 3
    assert sorted((clear["partyCount"], tuple(clear["historyMemberIds"])) for clear in clears) == [
        (4, ("m1", "m2", "m3", "m4")),
        (6, ("m1", "m3")),
        (6, ("m5", "m6")),
    ]


def test_will_clear_surfaces_ft_item_drop_for_sealed_mirror_world_nodestone() -> None:
    request = request_for("m1")
    histories = {
        "m1": [{
            "raffledAt": request.raffledAt,
            "layerId": 205044,
            "clearInformations": [{"clearedAt": "2026-07-23T14:00:00Z", "partyCount": 1}],
            "prizes": [{"itemId": 2358010, "winCount": {"value": "1"}}],
        }]
    }
    layers = [{"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}}]
    metadata = {2358010: {"itemName": "Sealed Mirror World Nodestone", "tier0": "Consumable", "tier1": "Voucher"}}

    result = normalize_live_history(request, histories, layers, metadata)

    member = result["clears"][0]["members"][0]
    assert member["drops"] == [{"dropId": "will-hard-m1-ftitem-1", "category": "FT_ITEM", "name": "Sealed Mirror World Nodestone", "quantity": "1", "imageUrl": ""}]


def test_generic_sealed_nodestone_never_surfaces_as_a_drop() -> None:
    request = request_for("m1")
    histories = {
        "m1": [{
            "raffledAt": request.raffledAt,
            "layerId": 205044,
            "clearInformations": [{"clearedAt": "2026-07-23T14:00:00Z", "partyCount": 1}],
            "prizes": [{"itemId": 2358005, "winCount": {"value": "1"}}],
        }]
    }
    layers = [{"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}}]
    metadata = {2358005: {"itemName": "Sealed Nodestone", "tier0": "Consumable", "tier1": "Voucher"}}

    result = normalize_live_history(request, histories, layers, metadata)

    assert result["clears"][0]["members"][0]["drops"] == []


def test_lucid_clear_never_surfaces_ft_item_drop_even_if_metadata_matches() -> None:
    request = request_for("m1")
    histories = {
        "m1": [{
            "raffledAt": request.raffledAt,
            "layerId": 205041,
            "clearInformations": [{"clearedAt": "2026-07-23T14:00:00Z", "partyCount": 1}],
            "prizes": [{"itemId": 2358010, "winCount": {"value": "1"}}],
        }]
    }
    layers = [{"layerId": 205041, "boss": {"bossName": "Lucid", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Lucid"}}]
    metadata = {2358010: {"itemName": "Sealed Mirror World Nodestone", "tier0": "Consumable", "tier1": "Voucher"}}

    result = normalize_live_history(request, histories, layers, metadata)

    assert result["clears"][0]["members"][0]["drops"] == []


def test_item_id_1000_classifies_as_power_crystal_with_no_metadata() -> None:
    # docs/IMPL_PLAN_RAFFLE_REWARD_VOCAB.md S1: itemId 1000 is a direct Power Crystal grant.
    # Metadata for it 404s upstream (same as NESO's itemId 1), so classification must not
    # depend on it being present.
    assert _classification(1000, None) == ("POWER_CRYSTAL", "Power Crystal")
    assert _classification(1000, {}) == ("POWER_CRYSTAL", "Power Crystal")


def test_ascendant_power_crystal_direct_item_id_amount_equals_quantity() -> None:
    # Acceptance criterion 1 (docs/IMPL_PLAN_RAFFLE_REWARD_VOCAB.md): the real-data shape --
    # an Ascendant history awarding `Item 1000 x 55,000,000` -- must settle to a
    # powerCrystalAmount of exactly 55,000,000, with no item metadata supplied at all (this
    # used to be 0 before this fix, since only the coupon-name pattern was recognized).
    request = request_for("m1")
    histories = {
        "m1": [
            {
                "raffledAt": request.raffledAt,
                "layerId": 205044,
                "clearInformations": [{"clearedAt": "2026-08-27T14:00:00Z", "partyCount": 1}],
                "prizes": [{"itemId": 1, "winCount": {"value": "70000000"}}],
            },
            {
                "raffledAt": request.raffledAt,
                "layerId": 900101,
                "clearInformations": [],
                "prizes": [
                    {"itemId": 1, "winCount": {"value": "70000000"}},
                    {"itemId": 1000, "winCount": {"value": "55000000"}},
                ],
            },
        ]
    }
    layers = [
        {"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}},
        {"layerId": 900101, "contents": {"groupName": "Ascendant Tier Raffle", "layerName": "Eternal Ascendant"}},
    ]

    result = normalize_live_history(request, histories, layers, {})

    member = result["clears"][0]["members"][0]
    assert member["powerCrystalAmount"] == "55000000"
    assert member["ascendantNeso"] == "70000000"


def test_legacy_power_crystal_coupon_still_recalculates_the_same_way() -> None:
    # Acceptance criterion 2 (docs/IMPL_PLAN_RAFFLE_REWARD_VOCAB.md): the old coupon-item
    # vocabulary (name pattern resolved via metadata) must keep working unchanged for
    # already-settled/older rounds -- no regression from adding the itemId 1000 direct path.
    request = request_for("m1")
    histories = {
        "m1": [
            {
                "raffledAt": request.raffledAt,
                "layerId": 205044,
                "clearInformations": [{"clearedAt": "2026-07-25T11:35:31Z", "partyCount": 1}],
                "prizes": [],
            },
            {
                "raffledAt": request.raffledAt,
                "layerId": 900101,
                "clearInformations": [],
                "prizes": [{"itemId": 2832960, "winCount": {"value": "5"}}],
            },
        ]
    }
    layers = [
        {"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}},
        {"layerId": 900101, "contents": {"groupName": "Ascendant Tier Raffle", "layerName": "Eternal Ascendant"}},
    ]
    metadata = {2832960: {"itemName": "10M Power Crystal Coupon"}}

    result = normalize_live_history(request, histories, layers, metadata)

    assert result["clears"][0]["members"][0]["powerCrystalAmount"] == "50000000"


def test_ring_box_classifies_as_equipment_and_surfaces_a_sellable_drop() -> None:
    # Acceptance criterion 3 (docs/IMPL_PLAN_RAFFLE_REWARD_VOCAB.md): Rank N Special Skill Ring
    # Box (tier1=Voucher, like Sealed Mirror World Nodestone) is now sellable EQUIPMENT, unlike
    # the still-excluded generic Sealed Nodestone.
    assert _classification(2358013, {"itemName": "Rank 2 Special Skill Ring Box", "tier0": "Consumable", "tier1": "Voucher"}) == ("EQUIPMENT", "Rank 2 Special Skill Ring Box")

    request = request_for("m1")
    histories = {
        "m1": [{
            "raffledAt": request.raffledAt,
            "layerId": 205041,
            "clearInformations": [{"clearedAt": "2026-08-27T14:00:00Z", "partyCount": 1}],
            "prizes": [{"itemId": 2358017, "winCount": {"value": "1"}}],
        }]
    }
    layers = [{"layerId": 205041, "boss": {"bossName": "Lucid", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Lucid"}}]
    metadata = {2358017: {"itemName": "Rank 6 Special Skill Ring Box", "tier0": "Consumable", "tier1": "Voucher"}}

    result = normalize_live_history(request, histories, layers, metadata)

    member = result["clears"][0]["members"][0]
    assert member["drops"] == [{"dropId": "lucid-hard-m1-equipment-1", "category": "EQUIPMENT", "name": "Rank 6 Special Skill Ring Box", "quantity": "1", "imageUrl": ""}]
    assert result["clears"][0]["excludedRewards"] == []


def test_clear_surfaces_excluded_other_rewards_merged_by_name_across_members() -> None:
    # Acceptance criterion 5 (docs/IMPL_PLAN_RAFFLE_REWARD_VOCAB.md): OTHER-classified rewards
    # (still not distributable, e.g. Sealed Nodestone) are surfaced per clear instead of
    # vanishing, with same-name quantities merged across every member of the clear.
    request = request_for("m1", "m2")
    histories = {
        "m1": [{
            "raffledAt": request.raffledAt,
            "layerId": 205041,
            "clearInformations": [{"clearedAt": "2026-08-27T14:00:00Z", "partyCount": 2}],
            "prizes": [{"itemId": 2358005, "winCount": {"value": "1"}}],
        }],
        "m2": [{
            "raffledAt": request.raffledAt,
            "layerId": 205041,
            "clearInformations": [{"clearedAt": "2026-08-27T14:00:30Z", "partyCount": 2}],
            "prizes": [{"itemId": 2358005, "winCount": {"value": "2"}}],
        }],
    }
    layers = [{"layerId": 205041, "boss": {"bossName": "Lucid", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Lucid"}}]
    metadata = {2358005: {"itemName": "Sealed Nodestone", "tier0": "Consumable", "tier1": "Voucher"}}

    result = normalize_live_history(request, histories, layers, metadata)

    assert result["clears"][0]["excludedRewards"] == [{"name": "Sealed Nodestone", "quantity": "3"}]
    # Internal-only field must never leak into the member payload.
    assert all("excludedRewards" not in member for member in result["clears"][0]["members"])


def test_clear_with_no_other_rewards_has_empty_excluded_rewards() -> None:
    request = request_for("m1")
    histories = {"m1": [{
        "raffledAt": request.raffledAt,
        "layerId": 205041,
        "clearInformations": [{"clearedAt": "2026-08-27T14:00:00Z", "partyCount": 1}],
        "prizes": [{"itemId": 1, "winCount": {"value": "100"}}],
    }]}
    layers = [{"layerId": 205041, "boss": {"bossName": "Lucid", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Lucid"}}]

    result = normalize_live_history(request, histories, layers, {})

    assert result["clears"][0]["excludedRewards"] == []


def test_chaos_slime_clear_generates_with_zero_coin_and_power_crystal() -> None:
    # docs/IMPL_PLAN_RAFFLE_CHAOS_SLIME.md S5 acceptance criteria 1-2: a Chaos Guardian Angel
    # Slime clear (boss prizes empty -- the real observed shape is a RAFFLE_STATE_PARTICIPATE_FAIL
    # boss roll) plus an Ascendant NESO win produces exactly one clear with the boss having no
    # coin and no Power Crystal.
    request = request_for("m1")
    histories = {
        "m1": [
            {
                "raffledAt": request.raffledAt,
                "layerId": 205045,
                "clearInformations": [{"clearedAt": "2026-08-22T14:30:13.660Z", "partyCount": 6}],
                "prizes": [],
            },
            {
                "raffledAt": request.raffledAt,
                "layerId": 900201,
                "clearInformations": [],
                "prizes": [{"itemId": 1, "winCount": {"value": "325000000"}}],
            },
        ]
    }
    layers = [
        {"layerId": 205045, "boss": {"bossName": "Guardian Angel Slime", "difficulty": "DIFFICULTY_CHAOS", "raffleLayerName": "Chaos Guardian Angel Slime"}},
        {"layerId": 900201, "contents": {"groupName": "Ascendant Tier Raffle", "layerName": "Eternal Ascendant Chaos Guardian"}},
    ]

    result = normalize_live_history(request, histories, layers, {})

    assert len(result["clears"]) == 1
    clear = result["clears"][0]
    assert clear["boss"] == "SLIME"
    assert clear["bossDifficulty"] == "CHAOS"
    assert clear["ascendantTier"] == "Eternal Ascendant Chaos Guardian"
    member = clear["members"][0]
    assert member["bossNeso"] == "0"
    assert member["ascendantNeso"] == "325000000"
    assert member["powerCrystalAmount"] == "0"
    assert member["drops"] == []


def test_chaos_slime_coin_classified_reward_surfaces_as_excluded_not_silently_dropped() -> None:
    # docs/IMPL_PLAN_RAFFLE_CHAOS_SLIME.md S2 regression: Slime has no coin configured at all
    # (TARGET_COINS has no "SLIME" entry), so a COIN-classified reward it wins must be
    # fail-visible via excludedRewards, not silently vanish (the failure class this whole
    # follow-up closes for the Ascendant side too).
    request = request_for("m1")
    histories = {
        "m1": [{
            "raffledAt": request.raffledAt,
            "layerId": 205045,
            "clearInformations": [{"clearedAt": "2026-08-22T14:30:13.660Z", "partyCount": 1}],
            "prizes": [{"itemId": 999001, "winCount": {"value": "5"}}],
        }]
    }
    layers = [{"layerId": 205045, "boss": {"bossName": "Guardian Angel Slime", "difficulty": "DIFFICULTY_CHAOS", "raffleLayerName": "Chaos Guardian Angel Slime"}}]
    metadata = {999001: {"itemName": "Phantasma Coin", "tier0": "Consumable", "tier1": "Exchange Currency"}}

    result = normalize_live_history(request, histories, layers, metadata)

    clear = result["clears"][0]
    assert clear["excludedRewards"] == [{"name": "Phantasma Coin", "quantity": "5"}]
    assert clear["members"][0]["drops"] == []


def test_normal_guardian_angel_slime_never_becomes_a_clear_candidate() -> None:
    # docs/IMPL_PLAN_RAFFLE_CHAOS_SLIME.md S5 acceptance criterion 5/§6#4: Normal Guardian Angel
    # Slime is out of scope (LULU-141 user ruling) -- absent from ASCENDANT_TIER_BY_BOSS, so
    # `_boss_distribution_context` returns None and it never surfaces as a clear candidate.
    request = request_for("m1")
    histories = {
        "m1": [{
            "raffledAt": request.raffledAt,
            "layerId": 205038,
            "clearInformations": [{"clearedAt": "2026-08-22T14:30:13.660Z", "partyCount": 1}],
            "prizes": [{"itemId": 1, "winCount": {"value": "100"}}],
        }]
    }
    layers = [{"layerId": 205038, "boss": {"bossName": "Guardian Angel Slime", "difficulty": "DIFFICULTY_NORMAL", "raffleLayerName": "Guardian Angel Slime"}}]

    result = normalize_live_history(request, histories, layers, {})

    assert result["clears"] == []


def test_shared_contract_fixture_matches_fixture_normalizer() -> None:
    root = Path(__file__).resolve().parents[3]
    fixture = json.loads((root / "testdata" / "raffle" / "v1" / "cases" / "fixture-lucid.json").read_text(encoding="utf-8"))
    result = fixture_result(CreateJobRequest.model_validate(fixture["request"]))
    expected = fixture["expectedJob"]
    assert result["raffleResults"] == expected["raffleResults"]
    assert result["clears"] == expected["clears"]
    assert result["warnings"] == expected["warnings"]
    assert result["errors"] == expected["errors"]
    assert result["memberWallets"] == expected["memberWallets"]