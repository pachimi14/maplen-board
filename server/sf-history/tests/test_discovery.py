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
