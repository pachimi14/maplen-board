"""SH-2/SH-3 §4: generate the SF-history target equipment list snapshot.

Reads the priority-equipment logic from maplenEnhancebot **read-only** --
maplenEnhancebot's ``priority_equipment.py`` / ``item_catalog.py`` remain the
source of truth for "which equipment" (DESIGN_SF_COST_HISTORY.md §3 / §7).
This script never writes into the maplenEnhancebot working tree: it disables
bytecode caching (``sys.dont_write_bytecode``) before importing, and only
ever opens files under its own ``--out`` path.

Output: ``data/sf_history_items.json``
    { "generatedAt": ..., "sourceRepo": "maplenEnhancebot", "sourceCommit": <hash>,
      "excluded": [{ "itemId": ..., "reason": ... }],
      "items": [{ "itemId": ..., "itemName": ..., "aliasItemIds": [...], "maxStar": ... }] }

Accept criterion (a): ``items`` must be exactly 28 entries (IMPL_PLAN_SH2 §4/§6).

``maxStar`` (SH-3, design §7.1) is derived from ``sf_price_history_hourly``'s
actual data (``MAX(item_upgrade) + 1``), never hardcoded -- if the backfill
DB is not present at ``--db``, ``maxStar`` is left ``null`` rather than
guessed.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import db  # noqa: E402

DEFAULT_SOURCE_REPO = Path(r"C:\Users\pachi\Desktop\maplenEnhancebot")
DEFAULT_OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "sf_history_items.json"
DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "sf_price_history.sqlite"
EXPECTED_ITEM_COUNT = 28

# SH-3 correction (IMPL_PLAN_SH3 §4(m), design §7): SH-2's implementer could
# not find the "原案" (original draft) text this exclusion traces back to in
# this repo's history, and wrote a *reconstructed* rationale (level-band
# outlier evidence) into this dict instead, flagged for confirmation in the
# SH-2 completion report. The architect has since confirmed the correct
# attribution: these two items were named explicitly by the user in the
# original 28-item draft list, not inferred from level-band data. The
# level-band evidence below is kept as corroborating context (it is true and
# was independently observed), but it is not the reason for the exclusion.
EXCLUDED_ITEM_IDS: dict[int, str] = {
    1113282: (
        "Noble Ifia's Ring -- one of the two items the user explicitly named for "
        "exclusion in the original 28-item draft list (design directive, "
        "DESIGN_SF_COST_HISTORY.md \u00a77 / IMPL_PLAN_SH3 \u00a74(m)). "
        "Corroborating context (not the reason): this is the only "
        "RANGE_118_TO_127 item in maplenEnhancebot's priority representative "
        "set (all 28 kept items are RANGE_128_TO_137+); it enters "
        "maplenEnhancebot's priority set only via a manual low-band override "
        "(EXTRA_PRIORITY_GROUPS, SNAP-1 S0) for gear-sim's own worn-item "
        "coverage, not as part of the endgame boss-accessory lineup this chart "
        "targets."
    ),
    1122254: (
        "Mechanator Pendant -- one of the two items the user explicitly named "
        "for exclusion in the original 28-item draft list (design directive, "
        "DESIGN_SF_COST_HISTORY.md \u00a77 / IMPL_PLAN_SH3 \u00a74(m)). "
        "Corroborating context (not the reason): same level-band outlier "
        "evidence as 1113282 (Noble Ifia's Ring) -- only RANGE_118_TO_127 item "
        "besides it in the priority representative set; manual low-band "
        "override in maplenEnhancebot, not part of the RANGE_128_TO_137+ "
        "endgame lineup."
    ),
}


def _max_upgrade_by_item(db_path: Path) -> dict[int, int]:
    if not db_path.exists():
        return {}
    conn = db.connect(db_path)
    try:
        return db.max_upgrade_by_item(conn)
    finally:
        conn.close()


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


def build_item_list(
    source_repo: Path = DEFAULT_SOURCE_REPO, db_path: Path = DEFAULT_DB_PATH
) -> dict[str, Any]:
    item_catalog, priority_equipment = _load_source_modules(source_repo)

    catalog = item_catalog.load_catalog()
    representative_ids = priority_equipment.load_priority_representative_item_ids()
    item_to_representative = priority_equipment.build_priority_item_to_representative_map()
    max_upgrade_by_item = _max_upgrade_by_item(db_path)

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
        max_upgrade = max_upgrade_by_item.get(representative)
        # design §7.1: maxStar is derived from hourly data (MAX(item_upgrade)+1),
        # never hardcoded. null when the backfill DB isn't available to derive it from.
        max_star = (max_upgrade + 1) if max_upgrade is not None else None
        items.append(
            {
                "itemId": representative,
                "itemName": name_by_representative.get(representative),
                "aliasItemIds": alias_ids,
                "maxStar": max_star,
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
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT_PATH)
    args = parser.parse_args()

    payload = build_item_list(args.source_repo, args.db)
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
