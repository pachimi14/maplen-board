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
