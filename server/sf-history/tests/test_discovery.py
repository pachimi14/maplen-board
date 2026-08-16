from __future__ import annotations

from typing import Any

import pytest

import discovery


def _entry(*, current_step: str, current_price: str = "100", start_date: str = "2026-08-15T09:28:00Z", previous_step: str | None = None, previous_price: str = "90", previous_start: str = "2026-08-15T09:27:00Z") -> dict[str, Any]:
    entry: dict[str, Any] = {
        "currentPrice": {
            "price": current_price,
            "startDate": start_date,
            "endDate": "2026-08-15T09:29:00Z",
            "createDate": "2026-08-15T09:28:29Z",
            "step": current_step,
        }
    }
    if previous_step is not None:
        entry["previousPrice"] = {
            "price": previous_price,
            "startDate": previous_start,
            "endDate": start_date,
            "createDate": "2026-08-15T09:27:29Z",
            "step": previous_step,
        }
    return entry


def _payload(entries_by_upgrade: dict[int, dict[str, Any]]) -> dict[str, Any]:
    return {
        "data": {
            "currentPrices": {
                "starforce": {str(k): v for k, v in entries_by_upgrade.items()}
            }
        }
    }


def _potential_payload(entries_by_cube_id: dict[int, dict[str, Any]]) -> dict[str, Any]:
    """IMPL_PLAN_SH34: same shape as `_payload` above, but under
    `data.currentPrices.potential` (cube itemId keys, not itemUpgrade)."""
    return {
        "data": {
            "currentPrices": {
                "potential": {str(k): v for k, v in entries_by_cube_id.items()}
            }
        }
    }


# --- parse_dynamicprice_steps ------------------------------------------------


def test_parse_steps_reads_every_band_0_to_24() -> None:
    entries = {i: _entry(current_step=discovery.CHANGE_STEP) for i in range(25)}
    payload = _payload(entries)
    steps = discovery.parse_dynamicprice_steps(payload)
    assert len(steps) == 25
    assert all(s == discovery.CHANGE_STEP for s in steps)


def test_parse_steps_ignores_out_of_range_and_non_numeric_keys() -> None:
    payload = _payload({0: _entry(current_step=discovery.DISCOVERY_STEP)})
    payload["data"]["currentPrices"]["starforce"]["25"] = _entry(current_step=discovery.DISCOVERY_STEP)
    payload["data"]["currentPrices"]["starforce"]["not-a-number"] = _entry(current_step=discovery.DISCOVERY_STEP)
    steps = discovery.parse_dynamicprice_steps(payload)
    assert steps[0] == discovery.DISCOVERY_STEP
    assert len(steps) == 25  # never extended past UPGRADE_COUNT


def test_parse_steps_raises_on_missing_starforce() -> None:
    with pytest.raises(discovery.InvalidDynamicPricePayload):
        discovery.parse_dynamicprice_steps({"data": {"currentPrices": {}}})
    with pytest.raises(discovery.InvalidDynamicPricePayload):
        discovery.parse_dynamicprice_steps({})


# --- pick_representative_item (★2026-08-15 VPS fix -- §5(u)/(v)) ------------


def test_pick_representative_item_picks_highest_week_count() -> None:
    items = [
        {"itemId": 1004808, "weekCount": 3153},
        {"itemId": 1004811, "weekCount": 4112},
        {"itemId": 1004809, "weekCount": 2109},
    ]
    result = discovery.pick_representative_item(items)
    assert result["itemId"] == 1004811


def test_pick_representative_item_none_for_empty_input() -> None:
    assert discovery.pick_representative_item([]) is None


def test_pick_representative_item_treats_missing_week_count_as_zero() -> None:
    items = [{"itemId": 1, "weekCount": 0}, {"itemId": 2}]
    result = discovery.pick_representative_item(items)
    assert result["itemId"] == 1  # tie at 0 -- lower itemId wins deterministically


def test_v_pick_representative_item_is_deterministic_regardless_of_input_order() -> None:
    """(v): a weekCount tie must resolve the same way no matter which order
    the API happens to list the tied candidates in -- ascending itemId."""
    a = {"itemId": 1004810, "weekCount": 500}
    b = {"itemId": 1004808, "weekCount": 500}  # tied with a, lower itemId
    c = {"itemId": 1004812, "weekCount": 100}

    result_order_1 = discovery.pick_representative_item([a, b, c])
    result_order_2 = discovery.pick_representative_item([b, a, c])
    result_order_3 = discovery.pick_representative_item([c, b, a])

    assert result_order_1["itemId"] == 1004808
    assert result_order_2["itemId"] == 1004808
    assert result_order_3["itemId"] == 1004808


# --- is_monitored (§5(c): ☆23-25 never used in judgment) --------------------


def test_is_monitored_true_when_a_judge_range_band_is_discovery() -> None:
    steps: list[str | None] = [discovery.CHANGE_STEP] * 25
    steps[21] = discovery.DISCOVERY_STEP  # itemUpgrade 21 == last judge-range band
    assert discovery.is_monitored(steps) is True


def test_is_monitored_false_when_only_display_only_bands_are_discovery() -> None:
    """(c) accept criterion, verbatim: a ☆24-only-DISCOVERY item must NOT be monitored."""
    steps: list[str | None] = [discovery.CHANGE_STEP] * 25
    steps[23] = discovery.DISCOVERY_STEP  # itemUpgrade 23 == ☆24, display-only
    assert discovery.is_monitored(steps) is False


def test_is_monitored_false_when_fully_change() -> None:
    assert discovery.is_monitored([discovery.CHANGE_STEP] * 25) is False


def test_is_monitored_handles_none_entries() -> None:
    steps: list[str | None] = [None] * 25
    assert discovery.is_monitored(steps) is False


# --- steps_consistent (A-1 / §5(g-3)) ----------------------------------------


def test_steps_consistent_true_when_all_members_match() -> None:
    a = [discovery.DISCOVERY_STEP] * 25
    b = list(a)
    assert discovery.steps_consistent({1001: a, 1002: b}) is True


def test_steps_consistent_false_on_any_mismatch() -> None:
    a = [discovery.DISCOVERY_STEP] * 25
    b = list(a)
    b[24] = discovery.CHANGE_STEP  # differs only in a display-only band -- still must be caught
    assert discovery.steps_consistent({1001: a, 1002: b}) is False


def test_steps_consistent_true_for_a_single_member_group() -> None:
    assert discovery.steps_consistent({1001: [discovery.DISCOVERY_STEP] * 25}) is True


# --- parse_dynamicprice_points (Component B) ---------------------------------


def test_parse_points_returns_current_and_previous_per_band() -> None:
    payload = _payload(
        {
            0: _entry(
                current_step=discovery.DISCOVERY_STEP,
                current_price=str(int(1e18)),
                start_date="2026-08-15T09:28:00Z",
                previous_step=discovery.DISCOVERY_STEP,
                previous_price=str(int(2e18)),
                previous_start="2026-08-15T09:27:00Z",
            )
        }
    )
    points = discovery.parse_dynamicprice_points(payload)
    assert set(points.keys()) == {0}
    band = points[0]
    assert len(band) == 2
    assert band[0] == {"priceAt": "2026-08-15T09:28:00Z", "endAt": "2026-08-15T09:29:00Z", "price": pytest.approx(1.0), "step": discovery.DISCOVERY_STEP}
    assert band[1] == {"priceAt": "2026-08-15T09:27:00Z", "endAt": "2026-08-15T09:28:00Z", "price": pytest.approx(2.0), "step": discovery.DISCOVERY_STEP}


def test_parse_points_drops_previous_when_absent() -> None:
    payload = _payload({0: _entry(current_step=discovery.CHANGE_STEP)})
    points = discovery.parse_dynamicprice_points(payload)
    assert len(points[0]) == 1


def test_parse_points_skips_previous_when_it_shares_the_current_window() -> None:
    """If upstream ever returns identical startDates for current/previous
    (should not normally happen, but must not silently produce a duplicate
    upsert key), only one point is kept."""
    payload = _payload(
        {
            0: _entry(
                current_step=discovery.CHANGE_STEP,
                start_date="2026-08-15T09:28:00Z",
                previous_step=discovery.CHANGE_STEP,
                previous_start="2026-08-15T09:28:00Z",
            )
        }
    )
    points = discovery.parse_dynamicprice_points(payload)
    assert len(points[0]) == 1


def test_parse_points_covers_all_25_bands_when_present() -> None:
    entries = {i: _entry(current_step=discovery.CHANGE_STEP, previous_step=discovery.CHANGE_STEP) for i in range(25)}
    payload = _payload(entries)
    points = discovery.parse_dynamicprice_points(payload)
    assert set(points.keys()) == set(range(25))
    assert all(len(v) == 2 for v in points.values())


def test_parse_points_ignores_bands_missing_a_usable_start_date() -> None:
    payload = _payload({0: {"currentPrice": {"price": "1", "step": discovery.CHANGE_STEP}}})
    points = discovery.parse_dynamicprice_points(payload)
    assert points == {}


# --- find_transition (§5(f)) --------------------------------------------------


def test_find_transition_detects_the_flip() -> None:
    rows = [
        ("2026-08-01T00:00:00Z", discovery.DISCOVERY_STEP),
        ("2026-08-01T00:05:00Z", discovery.DISCOVERY_STEP),
        ("2026-08-01T00:10:00Z", discovery.CHANGE_STEP),
        ("2026-08-01T00:15:00Z", discovery.CHANGE_STEP),
    ]
    assert discovery.find_transition(rows) == ("2026-08-01T00:05:00Z", "2026-08-01T00:10:00Z")


def test_find_transition_none_when_still_fully_discovery() -> None:
    rows = [("2026-08-01T00:00:00Z", discovery.DISCOVERY_STEP), ("2026-08-01T00:05:00Z", discovery.DISCOVERY_STEP)]
    assert discovery.find_transition(rows) is None


def test_find_transition_none_when_change_from_the_start() -> None:
    """No DISCOVERY row ever seen before the CHANGE rows -- we never witnessed
    a flip (F3: cannot be reconstructed after the fact), so this must not be
    reported as a transition."""
    rows = [("2026-08-01T00:00:00Z", discovery.CHANGE_STEP), ("2026-08-01T00:05:00Z", discovery.CHANGE_STEP)]
    assert discovery.find_transition(rows) is None


def test_find_transition_ignores_row_order() -> None:
    rows = [
        ("2026-08-01T00:10:00Z", discovery.CHANGE_STEP),
        ("2026-08-01T00:00:00Z", discovery.DISCOVERY_STEP),
    ]
    assert discovery.find_transition(rows) == ("2026-08-01T00:00:00Z", "2026-08-01T00:10:00Z")


def test_find_transition_takes_the_first_change_after_the_last_discovery() -> None:
    rows = [
        ("2026-08-01T00:00:00Z", discovery.DISCOVERY_STEP),
        ("2026-08-01T00:05:00Z", discovery.CHANGE_STEP),
        ("2026-08-01T00:10:00Z", discovery.CHANGE_STEP),
    ]
    assert discovery.find_transition(rows) == ("2026-08-01T00:00:00Z", "2026-08-01T00:05:00Z")


# --- IMPL_PLAN_SH34 §2-1: parse_dynamicprice_cube_points ----------------------


def test_parse_cube_points_reads_the_potential_map_keyed_by_cube_item_id() -> None:
    payload = _potential_payload(
        {
            2711000: _entry(
                current_step=discovery.DISCOVERY_STEP,
                current_price=str(int(1e18)),
                start_date="2026-08-16T15:09:00Z",
                previous_step=discovery.DISCOVERY_STEP,
                previous_price=str(int(1e18)),
                previous_start="2026-08-16T15:08:00Z",
            ),
            5062010: _entry(
                current_step=discovery.CHANGE_STEP,
                current_price="571963825511000000000000",
                start_date="2026-08-16T15:09:00Z",
                previous_step=discovery.CHANGE_STEP,
                previous_price="572109820597000000000000",
                previous_start="2026-08-16T15:08:00Z",
            ),
        }
    )
    points = discovery.parse_dynamicprice_cube_points(payload)
    assert set(points.keys()) == {2711000, 5062010}
    assert len(points[2711000]) == 2
    assert points[2711000][0]["step"] == discovery.DISCOVERY_STEP
    assert points[5062010][0]["price"] == pytest.approx(571963.825511)


def test_parse_cube_points_returns_empty_dict_when_potential_absent() -> None:
    """(G6): a payload with only `starforce` (no `potential` at all) is not
    an error -- unlike `parse_dynamicprice_steps`'s `starforce` requirement."""
    payload = _payload({0: _entry(current_step=discovery.CHANGE_STEP)})
    assert discovery.parse_dynamicprice_cube_points(payload) == {}
    assert discovery.parse_dynamicprice_cube_points({}) == {}
    assert discovery.parse_dynamicprice_cube_points({"data": {"currentPrices": {}}}) == {}


def test_parse_cube_points_ignores_non_numeric_keys() -> None:
    payload = _potential_payload({2711000: _entry(current_step=discovery.DISCOVERY_STEP)})
    payload["data"]["currentPrices"]["potential"]["not-a-cube-id"] = _entry(current_step=discovery.DISCOVERY_STEP)
    points = discovery.parse_dynamicprice_cube_points(payload)
    assert set(points.keys()) == {2711000}


def test_parse_cube_points_drops_previous_when_absent() -> None:
    payload = _potential_payload({2711000: _entry(current_step=discovery.CHANGE_STEP)})
    points = discovery.parse_dynamicprice_cube_points(payload)
    assert len(points[2711000]) == 1


def test_parse_cube_points_a_seventh_unknown_cube_id_is_still_parsed() -> None:
    """(d)/G6: this parser never assumes the 6-cube set -- any numeric key
    under `potential` is read, whether or not `discovery.CUBE_NAMES` knows
    it (naming is a separate, display-only concern -- see cube_display_name
    tests below)."""
    payload = _potential_payload({9999999: _entry(current_step=discovery.DISCOVERY_STEP)})
    points = discovery.parse_dynamicprice_cube_points(payload)
    assert set(points.keys()) == {9999999}


# --- IMPL_PLAN_SH34 §2-2 (revised): cube_display_name / CUBE_NAMES -----------


def test_cube_display_name_resolves_a_known_code() -> None:
    assert discovery.cube_display_name(2711000) == "Occult Cube"
    assert discovery.cube_display_name(5062503) == "White Cube"


def test_cube_display_name_falls_back_to_the_code_for_an_unknown_id() -> None:
    """(d): an unrecognized cube itemId is shown as the code itself, never a
    guessed name."""
    assert discovery.cube_display_name(9999999) == "9999999"


def test_cube_names_has_exactly_the_six_observed_cubes() -> None:
    assert set(discovery.CUBE_NAMES.keys()) == {2711000, 2730000, 5062009, 5062010, 5062500, 5062503}
