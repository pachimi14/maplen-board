"""SH-2 §4: generate the SF-history target equipment list snapshot.

Reads the priority-equipment logic from maplenEnhancebot **read-only** --
maplenEnhancebot's ``priority_equipment.py`` / ``item_catalog.py`` remain the
source of truth for "which equipment" (DESIGN_SF_COST_HISTORY.md §3 / §7).
This script never writes into the maplenEnhancebot working tree: it disables
bytecode caching (``sys.dont_write_bytecode``) before importing, and only
ever opens files under its own ``--out`` path.

Output: ``data/sf_history_items.json``
    { "generatedAt": ..., "sourceRepo": "maplenEnhancebot", "sourceCommit": <hash>,
      "excluded": [{ "itemId": ..., "reason": ... }],
      "items": [{ "itemId": ..., "itemName": ..., "aliasItemIds": [...] }] }

Accept criterion (a): ``items`` must be exactly 28 entries (IMPL_PLAN_SH2 §4/§6).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_SOURCE_REPO = Path(r"C:\Users\pachi\Desktop\maplenEnhancebot")
DEFAULT_OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "sf_history_items.json"
EXPECTED_ITEM_COUNT = 28

# IMPL_PLAN_SH2 §4 / DESIGN_SF_COST_HISTORY.md §7: excluded by explicit design
# directive. Evidence gathered while implementing this script (2026-08-05):
# these are the *only* two items in maplenEnhancebot's priority representative
# set at level band RANGE_118_TO_127 -- every other of the 30 priority
# representatives is RANGE_128_TO_137 or higher. In maplenEnhancebot itself
# they only enter the priority set via a manual override
# (`priority_equipment.EXTRA_PRIORITY_GROUPS`, tagged "SNAP-1 S0") specifically
# because `BOSS_ACCESSORY_EXCLUDED_LEVEL_TYPES` normally drops that band; that
# override exists for gear-sim's own per-character worn-item coverage, not
# because these items continue the RANGE_128_TO_137+ endgame lineup this SF
# price-history chart targets. This implementer could not find the original
# "原案" text the design doc references (docs/DESIGN_SF_COST_HISTORY.md §7,
# IMPL_PLAN_SH2 §4) in this repo's committed history, so the reason below is
# reconstructed from that evidence rather than quoted verbatim -- flagged for
# architect confirmation in the SH-2 completion report.
EXCLUDED_ITEM_IDS: dict[int, str] = {
    1113282: (
        "Noble Ifia's Ring -- design directive (DESIGN_SF_COST_HISTORY.md §7, "
        "IMPL_PLAN_SH2 §4) excludes this item. Reconstructed rationale: only "
        "RANGE_118_TO_127 item in the priority representative set (all 28 kept "
        "items are RANGE_128_TO_137+); enters maplenEnhancebot's priority set "
        "only via a manual low-band override (EXTRA_PRIORITY_GROUPS, SNAP-1 S0) "
        "for gear-sim's own worn-item coverage, not as part of the endgame "
        "boss-accessory lineup this chart targets."
    ),
    1122254: (
        "Mechanator Pendant -- design directive (DESIGN_SF_COST_HISTORY.md §7, "
        "IMPL_PLAN_SH2 §4) excludes this item. Reconstructed rationale: same as "
        "1113282 (Noble Ifia's Ring) -- only RANGE_118_TO_127 item besides it in "
        "the priority representative set; manual low-band override in "
        "maplenEnhancebot, not part of the RANGE_128_TO_137+ endgame lineup."
    ),
}


def _load_source_modules(source_repo: Path) -> tuple[Any, Any]:
    """Import maplenEnhancebot's item_catalog/priority_equipment read-only.

    ``sys.dont_write_bytecode = True`` is set *before* the import so no
    ``__pycache__/*.pyc`` is ever written into the source repo (it is
    read-only for this スライス -- see IMPL_PLAN_SH2 §1).
    """
    sys.dont_write_bytecode = True
    source_repo_str = str(source_repo)
    if source_repo_str not in sys.path:
        sys.path.insert(0, source_repo_str)
    import item_catalog  # type: ignore
    import priority_equipment  # type: ignore

    return item_catalog, priority_equipment


def _source_commit(source_repo: Path) -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=str(source_repo),
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def build_item_list(source_repo: Path = DEFAULT_SOURCE_REPO) -> dict[str, Any]:
    item_catalog, priority_equipment = _load_source_modules(source_repo)

    catalog = item_catalog.load_catalog()
    representative_ids = priority_equipment.load_priority_representative_item_ids()
    item_to_representative = priority_equipment.build_priority_item_to_representative_map()

    representative_to_aliases: dict[int, set[int]] = {}
    for item_id, representative in item_to_representative.items():
        representative_to_aliases.setdefault(int(representative), set()).add(int(item_id))

    name_by_representative: dict[int, str | None] = {}
    for group in catalog.get("groups", []):
        representative = item_catalog.group_representative_item_id(group)
        if representative is not None:
            name_by_representative[int(representative)] = group.get("representative_item_name")
    for group in priority_equipment.EXTRA_PRIORITY_GROUPS:
        name_by_representative[int(group["representative_item_id"])] = group.get(
            "representative_item_name"
        )

    items: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    for representative in representative_ids:
        if representative in EXCLUDED_ITEM_IDS:
            excluded.append(
                {"itemId": representative, "reason": EXCLUDED_ITEM_IDS[representative]}
            )
            continue
        alias_ids = sorted(representative_to_aliases.get(representative, {representative}))
        items.append(
            {
                "itemId": representative,
                "itemName": name_by_representative.get(representative),
                "aliasItemIds": alias_ids,
            }
        )

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceRepo": "maplenEnhancebot",
        "sourceCommit": _source_commit(source_repo),
        "excluded": excluded,
        "items": items,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-repo", type=Path, default=DEFAULT_SOURCE_REPO)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT_PATH)
    args = parser.parse_args()

    payload = build_item_list(args.source_repo)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    item_count = len(payload["items"])
    print(
        f"items: {item_count}  excluded: {len(payload['excluded'])}  "
        f"sourceCommit: {payload['sourceCommit']}  -> {args.out}",
        file=sys.stderr,
    )
    if item_count != EXPECTED_ITEM_COUNT:
        print(
            f"WARNING: expected exactly {EXPECTED_ITEM_COUNT} items "
            f"(IMPL_PLAN_SH2 §4/§6 accept criterion (a)), got {item_count}. "
            "This is a stop condition -- do not proceed to backfill.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
