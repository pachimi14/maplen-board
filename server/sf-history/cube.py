"""IMPL_PLAN_SH39 §1: the CUBE (prospective) price-history sub-types this
feature tracks.

``itemUpgradeType=UPGRADE_PROSPECTIVE``'s ``itemUpgradeSubType`` upstream
also returns ``SUSPICIOUS`` / ``SUSPICIOUS_ADDITIONAL`` (Occult cubes) --
those are DELIBERATELY excluded (plan §1, user ruling: 対象外). This tuple
is the single place that decides "all cube sub-types" for this feature --
every backfill/aggregate/update script iterates it rather than re-deriving
or hardcoding its own list, so a future upstream addition (or a stray
SUSPICIOUS row from a hand-typed request) can never silently widen scope
(accept criterion (a): "上流の全 subType を無条件に取り込まない").

Display names (Red Cube / Black Cube / Bonus Potential Cube / White Bonus
Cube) belong to the next slice's UI, not here -- this module is data-layer
only (plan: "本スライスはデータ取得のみ").
"""

from __future__ import annotations

CUBE_SUB_TYPES: tuple[str, ...] = ("RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL")

# IMPL_PLAN_SH40 §3: the CURRENT-price upstream (`dynamicprice`'s
# `data.currentPrices.potential`, read by `fetch_latest.parse_potential_
# cubes`) is keyed by each cube's own itemId, not by `cube_sub_type` --
# confirmed live (item 1382265, 2026-08-22 probe): potential's 6 keys are
# exactly `discovery.CUBE_NAMES`'s 6 entries. This is the one place that
# maps each of THIS feature's 4 `CUBE_SUB_TYPES` (Occult / Bonus Occult
# deliberately excluded, same as above) onto that itemId, so the current-price
# read lands on the SAME (item_id, cube_sub_type) key every other cube table
# in this codebase already uses -- never re-derived or hardcoded a second
# time elsewhere.
CUBE_ITEM_ID_BY_SUB_TYPE: dict[str, int] = {
    "RED": 5062009,
    "BLACK": 5062010,
    "ADDITIONAL": 5062500,
    "WHITE_ADDITIONAL": 5062503,
}
