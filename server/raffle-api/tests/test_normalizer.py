from __future__ import annotations

import json
from pathlib import Path

import pytest

from contracts import CreateJobRequest
from normalizer import _boss_distribution_context, fixture_result, normalize_live_history


def request_for(*member_ids: str) -> CreateJobRequest:
    return CreateJobRequest.model_validate({"raffledAt": "2026-07-30T00:00:00Z", "characters": [{"memberId": member_id, "assetKey": "CHARfixture" + str(index + 1).zfill(3)} for index, member_id in enumerate(member_ids)]})


def test_fixture_result_keeps_all_visible_results_but_scopes_settlement_clear() -> None:
    result = fixture_result(request_for("m1"))
    assert {clear["boss"] for clear in result["clears"]} == {"LUCID", "WILL"}
    lucid = result["clears"][0]
    assert lucid["bossDifficulty"] == "HARD"
    assert lucid["ascendantTier"] == "Divine Ascendant"
    assert lucid["members"][0]["bossNeso"] == "600"
    assert lucid["members"][0]["drops"][0]["category"] == "COIN"
    assert {entry["bossName"] for entry in result["raffleResults"]} == {"Lucid", "Will", "Other Boss"}


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
        1001000: {"itemName": "Arcane Test Hat", "tier0": "Equipment", "imageUrl": "https://api-static.msu.io/itemimages/icon/1001000.png"},
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
    request = request_for("m1", "m2")
    histories = {
        "m1": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T14:00:00Z", "partyCount": 2}], "prizes": []}],
        "m2": [{"raffledAt": request.raffledAt, "layerId": 205044, "clearInformations": [{"clearedAt": "2026-07-23T15:00:00.001Z", "partyCount": 2}], "prizes": []}],
    }
    layers = [{"layerId": 205044, "boss": {"bossName": "Will", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Will"}}]

    assert normalize_live_history(request, histories, layers, {})["clears"] == []


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

    assert [(clear["boss"], clear["historyMemberIds"]) for clear in clears] == [("WILL", ["m1", "m2", "m3", "m4"])]


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
    assert {clear["clearId"] for clear in clears} == {"clear-will-hard-p5", "clear-will-hard-p6"}
    five_clear = next(clear for clear in clears if clear["partyCount"] == 5)
    six_clear = next(clear for clear in clears if clear["partyCount"] == 6)
    assert five_clear["boss"] == "WILL" and five_clear["bossDifficulty"] == "HARD"
    assert five_clear["historyMemberIds"] == ["m1", "m2", "m3", "m4", "m5"]
    assert [member["bossNeso"] for member in five_clear["members"]] == ["500000"] * 5 + ["0"]
    assert six_clear["historyMemberIds"] == ["m6"]
    assert [member["bossNeso"] for member in six_clear["members"]] == ["0"] * 5 + ["900000"]


def test_ambiguous_party_count_cluster_is_excluded_without_affecting_other_candidates() -> None:
    request = request_for("m1", "m2", "m3", "m4", "m5")
    histories = {
        # partyCount=6: two disjoint one-hour windows of equal size (m1+m2 vs m3+m4) tie for
        # the largest cluster, so this partyCount cannot be resolved and must be dropped with
        # a warning while the clean partyCount=5 candidate below is still returned.
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

    assert [clear["partyCount"] for clear in result["clears"]] == [5]
    assert result["clears"][0]["clearId"] == "clear-will-hard-p5"
    assert result["clears"][0]["historyMemberIds"] == ["m1", "m2", "m5"]
    assert result["warnings"] == [{"code": "ambiguous_party_cluster", "boss": "WILL", "bossDifficulty": "HARD", "partyCount": 6}]


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