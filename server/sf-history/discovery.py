"""IMPL_PLAN_SH32: DISCOVERY (bonus period) detection/parsing helpers.

Pure functions only -- no network, no SQLite, no filesystem -- so this module
is directly unit-testable offline (`tests/test_discovery.py`). The I/O
(`scripts/scan_discovery.py` Component A, `scripts/poll_discovery.py`
Component B, `app.py`'s `/sf-history/discovery/*` routes Component C) all
import this and `db.py`'s new `sf_discovery_*` accessors, but this file
itself never touches either.

Source shape (plan §0 F1/F4, confirmed live 2026-08-15 -- see the completion
report): the official Open API `dynamicprice` response's
`data.currentPrices.starforce` is a string-keyed object, star 0..24
currently, each entry:

    {"currentPrice": {"price": "...", "startDate": ..., "endDate": ...,
                       "createDate": ..., "step": "STEP_TYPE_DISCOVERY"
                                                  | "STEP_TYPE_CHANGE"},
     "previousPrice": {...same shape...} | absent}

`step` is the ground truth for "is this band in a DISCOVERY (bonus) period
right now" (F1) -- price is NOT a usable proxy (F5: DISCOVERY prices are not
monotonic). This module never assumes the key set is exactly 0..24 (plan §5
condition (b) failure mode / IMPL_PLAN_SH23 precedent): any key that parses
as `int` is kept, `UPGRADE_COUNT`/`JUDGE_UPGRADE_COUNT` only bound what is
*read out* into the fixed-length lists this module returns.
"""

from __future__ import annotations

from typing import Any

# plan §1: judgment range (itemUpgrade 0..21, i.e. ☆1..22) is narrower than
# display range (itemUpgrade 0..24, i.e. ☆1..25) -- ☆23-25 are real bands
# (itemUpgrade 22..24 DO exist, F10) but are deliberately excluded from the
# "is this equipment worth monitoring" judgment (§1: "まだ誰も到達していない
# だけで、新装備かどうかと無関係"), never from the price *display* once an
# equipment IS monitored (§1 table, §5(h)).
UPGRADE_COUNT = 25  # itemUpgrade 0..24 -- display range (§1)
JUDGE_UPGRADE_COUNT = 22  # itemUpgrade 0..21 -- judgment range (§1)

DISCOVERY_STEP = "STEP_TYPE_DISCOVERY"
CHANGE_STEP = "STEP_TYPE_CHANGE"

# Same conversion this codebase already applies to this exact upstream
# endpoint's `price` field (fetch_latest.py's `PRICE_DIVISOR` /
# `parse_openapi_payload`) -- duplicated here as a constant, not re-derived,
# so both modules stay in obvious lockstep if it is ever revisited. Do NOT
# apply this to `sf_price_history_hourly`/`_4h`'s `end_price` -- that is a
# different upstream field, already unconverted-scale (schema.sql's comment).
PRICE_DIVISOR = 1e18


class InvalidDynamicPricePayload(ValueError):
    """Raised when a `dynamicprice` response has no usable `starforce` map."""


def _starforce_map(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data")
    if not isinstance(data, dict):
        data = payload
    current_prices = data.get("currentPrices")
    starforce = current_prices.get("starforce") if isinstance(current_prices, dict) else None
    if not isinstance(starforce, dict) or not starforce:
        raise InvalidDynamicPricePayload("payload missing data.currentPrices.starforce")
    return starforce


def _numbered_entries(starforce: dict[str, Any]) -> list[tuple[int, Any]]:
    numbered: list[tuple[int, Any]] = []
    for key, entry in starforce.items():
        try:
            numbered.append((int(key), entry))
        except (TypeError, ValueError):
            continue
    numbered.sort(key=lambda pair: pair[0])
    return numbered


def parse_dynamicprice_steps(payload: dict[str, Any]) -> list[str | None]:
    """The `step` of every band's CURRENT price, as a fixed-length
    `UPGRADE_COUNT` (25) list (index = itemUpgrade). `None` where the band is
    missing, unparseable, or out of `[0, UPGRADE_COUNT)`.

    This is what Component A's scan reads to judge/record a snapshot -- it
    never looks at `price` (F5: not a usable proxy).
    """
    starforce = _starforce_map(payload)
    steps: list[str | None] = [None] * UPGRADE_COUNT
    for upgrade, entry in _numbered_entries(starforce):
        if not (0 <= upgrade < UPGRADE_COUNT):
            continue
        current = entry.get("currentPrice") if isinstance(entry, dict) else None
        if isinstance(current, dict):
            step = current.get("step")
            steps[upgrade] = step if isinstance(step, str) else None
    return steps


def _point_from_entry(entry: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(entry, dict):
        return None
    raw_price = entry.get("price")
    step = entry.get("step")
    if raw_price is None or not isinstance(step, str):
        return None
    try:
        price = float(raw_price) / PRICE_DIVISOR
    except (TypeError, ValueError):
        return None
    price_at = entry.get("startDate")
    return {
        "priceAt": price_at if isinstance(price_at, str) and price_at else None,
        "endAt": entry.get("endDate") if isinstance(entry.get("endDate"), str) else None,
        "price": price,
        "step": step,
    }


def parse_dynamicprice_points(payload: dict[str, Any]) -> dict[int, list[dict[str, Any]]]:
    """Component B's read: for every band (itemUpgrade -> points), both the
    `currentPrice` and `previousPrice` windows (plan §2 B: "1回で2点得られる"
    -- "同じ (itemId, itemUpgrade, startDate) は1行" is enforced by the
    caller's upsert, not here). A point missing `priceAt` (no usable
    `startDate`) is dropped -- it can never form a upsert key.

    Bands with neither a usable current nor previous point are simply absent
    from the returned dict (never an empty list) -- callers should treat a
    missing key as "nothing to write for this band this poll".
    """
    starforce = _starforce_map(payload)
    result: dict[int, list[dict[str, Any]]] = {}
    for upgrade, entry in _numbered_entries(starforce):
        if not (0 <= upgrade < UPGRADE_COUNT) or not isinstance(entry, dict):
            continue
        points: list[dict[str, Any]] = []
        current_point = _point_from_entry(entry.get("currentPrice"))
        if current_point is not None and current_point["priceAt"] is not None:
            points.append(current_point)
        previous_point = _point_from_entry(entry.get("previousPrice"))
        if (
            previous_point is not None
            and previous_point["priceAt"] is not None
            and previous_point["priceAt"] != (current_point or {}).get("priceAt")
        ):
            points.append(previous_point)
        if points:
            result[upgrade] = points
    return result


def is_monitored(steps: list[str | None]) -> bool:
    """plan §1: does this item have a DISCOVERY band in the JUDGE range
    (itemUpgrade 0..21)? ☆23-25 (itemUpgrade 22..24) are never consulted --
    §5(c)'s accept criterion.
    """
    return any(steps[i] == DISCOVERY_STEP for i in range(min(JUDGE_UPGRADE_COUNT, len(steps))))


def steps_consistent(member_steps: dict[int, list[str | None]]) -> bool:
    """plan §2 A-1: does every group member's full (display-range, 0..24)
    step list match every other member's, band for band? An empty/singleton
    input is trivially consistent.

    This checks the FULL display range (not just the judge range) -- a
    mismatch anywhere in 0..24 is exactly the "F7 stopped holding" signal
    IMPL_PLAN_SH32 §2 A-1 wants detected, even if it happens to fall in a
    band that judgment itself ignores.
    """
    lists = list(member_steps.values())
    if len(lists) <= 1:
        return True
    first = lists[0]
    return all(candidate == first for candidate in lists[1:])


def find_transition(rows: list[tuple[str, str]]) -> tuple[str, str] | None:
    """Given one band's `(price_at, step)` rows (ANY order), find the DISCOVERY
    -> CHANGE flip: the LAST `price_at` (chronologically) that was still
    DISCOVERY, and the FIRST `price_at` after it that is CHANGE (plan §5(f)).

    Returns `(last_discovery_price_at, first_change_price_at)` -- the
    5-minute-poll uncertainty window plan §2 B insists on keeping explicit
    ("遷移の時刻は「5分の幅」までしか特定できない") -- or `None` if no such
    flip is present in `rows` (still fully DISCOVERY, fully CHANGE from the
    first row we ever saw, or too little data). Relies on `price_at` sorting
    lexicographically the same as chronologically (fixed-width ISO8601 UTC
    "...Z", same assumption `aggregate.compute_buckets` already makes).
    """
    ordered = sorted(rows, key=lambda row: row[0])
    last_discovery_at: str | None = None
    for price_at, step in ordered:
        if step == DISCOVERY_STEP:
            last_discovery_at = price_at
        elif step == CHANGE_STEP and last_discovery_at is not None:
            return (last_discovery_at, price_at)
    return None
