from __future__ import annotations

import json
from pathlib import Path

import audit_high_star_plateau as audit
import db


ITEMS = {
    "items": [
        {"itemId": 1, "itemName": "Matches"},
        {"itemId": 2, "itemName": "Mismatches"},
        {"itemId": 3, "itemName": "NoOverlap"},
    ]
}


def _seed(db_path: Path) -> None:
    conn = db.connect(db_path)
    db.apply_schema(conn)

    # item 1: 20 and 21 identical at every shared timestamp.
    for upgrade in (20, 21):
        db.upsert_hourly_rows(
            conn, 1, upgrade,
            [{"date": "2026-01-01T00:00:00Z", "endPrice": 500.0, "sumEnhanceCnt": 0},
             {"date": "2026-01-01T01:00:00Z", "endPrice": 500.0, "sumEnhanceCnt": 0}],
            "2026-08-05T00:00:00Z",
        )

    # item 2: differ at one shared timestamp.
    db.upsert_hourly_rows(
        conn, 2, 20,
        [{"date": "2026-01-01T00:00:00Z", "endPrice": 100.0, "sumEnhanceCnt": 0}],
        "2026-08-05T00:00:00Z",
    )
    db.upsert_hourly_rows(
        conn, 2, 21,
        [{"date": "2026-01-01T00:00:00Z", "endPrice": 200.0, "sumEnhanceCnt": 0}],
        "2026-08-05T00:00:00Z",
    )

    # item 3: only itemUpgrade=20 has data, no overlap with 21.
    db.upsert_hourly_rows(
        conn, 3, 20,
        [{"date": "2026-01-01T00:00:00Z", "endPrice": 300.0, "sumEnhanceCnt": 0}],
        "2026-08-05T00:00:00Z",
    )
    conn.close()


def test_audit_classifies_matched_unmatched_and_no_overlap(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    items_path = tmp_path / "items.json"
    items_path.write_text(json.dumps(ITEMS), encoding="utf-8")
    _seed(db_path)

    result = audit.run_audit(db_path, items_path)

    assert result["itemsChecked"] == 3
    assert result["fullyMatchedCount"] == 1
    assert result["unmatchedCount"] == 1
    assert result["noOverlapCount"] == 1

    unmatched = result["unmatchedDetail"][0]
    assert unmatched["itemId"] == 2
    assert unmatched["mismatchCount"] == 1
    assert unmatched["commonPoints"] == 1

    assert result["noOverlapDetail"] == [{"itemId": 3, "itemName": "NoOverlap"}]


def test_compare_item_matched_flag_requires_nonzero_overlap(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    conn = db.connect(db_path)
    db.apply_schema(conn)
    conn.close()

    conn = db.connect(db_path)
    row = audit.compare_item(conn, 999, "Ghost")
    conn.close()

    assert row["commonPoints"] == 0
    assert row["fullyMatched"] is False
    assert row["noOverlap"] is True
