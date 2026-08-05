"""SH-2 §9.2 audit: do the star20/star21 end_price series match exactly?

DESIGN_SF_COST_HISTORY.md §9.2 flagged that a single latest-snapshot sample
showed itemUpgrade 20/21/22 sharing the exact same closePrice. This script
answers, over the *full* 150-day hourly backfill and all 28 equipment,
whether the itemUpgrade=20 and itemUpgrade=21 end_price series are identical
at every timestamp they share.

itemUpgrade=22 is intentionally out of scope: SH-2 never fetches it
(IMPL_PLAN_SH2 §5), so only 20 vs 21 can be compared from this DB.

This script does not decide anything (U6 in the design doc's 未決 list is a
統括 + ユーザー裁定, not an implementer judgment call, per IMPL_PLAN_SH2 §7).
It only reports counts: report honestly, whatever the result.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "sf_price_history.sqlite"
DEFAULT_ITEMS_PATH = Path(__file__).resolve().parent.parent / "data" / "sf_history_items.json"

UPGRADE_A = 20
UPGRADE_B = 21


def load_series(conn: sqlite3.Connection, item_id: int, item_upgrade: int) -> dict[str, float]:
    cur = conn.execute(
        "SELECT price_at, end_price FROM sf_price_history_hourly "
        "WHERE item_id = ? AND item_upgrade = ? ORDER BY price_at",
        (item_id, item_upgrade),
    )
    return {row[0]: row[1] for row in cur.fetchall()}


def compare_item(conn: sqlite3.Connection, item_id: int, item_name: str | None) -> dict[str, Any]:
    series_a = load_series(conn, item_id, UPGRADE_A)
    series_b = load_series(conn, item_id, UPGRADE_B)
    common = sorted(set(series_a) & set(series_b))
    mismatches = [
        {"priceAt": at, f"endPrice{UPGRADE_A}": series_a[at], f"endPrice{UPGRADE_B}": series_b[at]}
        for at in common
        if series_a[at] != series_b[at]
    ]
    return {
        "itemId": item_id,
        "itemName": item_name,
        "commonPoints": len(common),
        "seriesLenA": len(series_a),
        "seriesLenB": len(series_b),
        "mismatchCount": len(mismatches),
        "mismatchesSample": mismatches[:10],
        "fullyMatched": len(mismatches) == 0 and len(common) > 0,
        "noOverlap": len(common) == 0,
    }


def run_audit(db_path: Path, items_path: Path) -> dict[str, Any]:
    items = json.loads(Path(items_path).read_text(encoding="utf-8"))["items"]
    conn = sqlite3.connect(str(db_path))
    try:
        per_item = [
            compare_item(conn, int(item["itemId"]), item.get("itemName")) for item in items
        ]
    finally:
        conn.close()

    matched = [row for row in per_item if row["fullyMatched"]]
    no_overlap = [row for row in per_item if row["noOverlap"]]
    unmatched = [row for row in per_item if not row["fullyMatched"] and not row["noOverlap"]]

    return {
        "upgradeA": UPGRADE_A,
        "upgradeB": UPGRADE_B,
        "itemsChecked": len(per_item),
        "fullyMatchedCount": len(matched),
        "unmatchedCount": len(unmatched),
        "noOverlapCount": len(no_overlap),
        "unmatchedDetail": [
            {
                "itemId": row["itemId"],
                "itemName": row["itemName"],
                "mismatchCount": row["mismatchCount"],
                "commonPoints": row["commonPoints"],
            }
            for row in unmatched
        ],
        "noOverlapDetail": [
            {"itemId": row["itemId"], "itemName": row["itemName"]} for row in no_overlap
        ],
        "perItem": per_item,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--items", type=Path, default=DEFAULT_ITEMS_PATH)
    parser.add_argument("--out", type=Path, default=None, help="Optional: write full JSON report here.")
    args = parser.parse_args()

    result = run_audit(args.db, args.items)

    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    summary = {k: v for k, v in result.items() if k != "perItem"}
    print(json.dumps(summary, indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
