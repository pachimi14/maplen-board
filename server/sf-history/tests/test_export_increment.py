from __future__ import annotations

import gzip
import io
import json
from pathlib import Path

import db
import export_increment

NOW = "2026-11-25T08:00:00Z"
# --days 3 -> cutoff 2026-11-22T08:00:00Z (inclusive)


def _seed(db_path: Path) -> None:
    conn = db.connect(db_path)
    db.apply_schema(conn)
    # SF: item 1001 upgrade 0: 1 row before the cutoff, 2 on/after. upgrade 1: 1 after.
    db.upsert_hourly_rows(
        conn, 1001, 0,
        [
            {"date": "2026-11-22T07:00:00Z", "endPrice": 10.0},          # old -> excluded
            {"date": "2026-11-22T08:00:00Z", "endPrice": 11.0, "step": 3, "sumEnhanceCnt": 5},  # == cutoff -> included
            {"date": "2026-11-24T23:00:00Z", "endPrice": 12.0},
        ],
        "2026-11-25T00:00:00Z",
    )
    db.upsert_hourly_rows(conn, 1001, 1, [{"date": "2026-11-24T00:00:00Z", "endPrice": 20.0}], "2026-11-25T00:00:00Z")
    # CUBE: 1 old, 2 recent
    db.upsert_cube_hourly_rows(
        conn, 2001, "RED",
        [
            {"date": "2026-11-01T00:00:00Z", "endPrice": 1.0},
            {"date": "2026-11-23T00:00:00Z", "endPrice": 2.0},
            {"date": "2026-11-24T00:00:00Z", "endPrice": 3.0},
        ],
        "2026-11-25T00:00:00Z",
    )
    conn.close()


def _read(path: Path) -> list[dict]:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return [json.loads(line) for line in fh]


def test_export_recent_window_only_with_table_key(tmp_path: Path, capsys) -> None:
    db_path = tmp_path / "x.sqlite"
    _seed(db_path)
    out = tmp_path / "inc.jsonl.gz"

    rc = export_increment.main(["--db", str(db_path), "--out", str(out), "--now", NOW])
    assert rc == 0

    records = _read(out)
    sf = [r for r in records if r["t"] == "sf"]
    cube = [r for r in records if r["t"] == "cube"]
    assert len(sf) == 3      # 2 (upgrade 0) + 1 (upgrade 1); the 11-22T07 row is excluded
    assert len(cube) == 2
    assert len(records) == 5
    assert {r["price_at"] for r in sf if r["item_upgrade"] == 0} == {"2026-11-22T08:00:00Z", "2026-11-24T23:00:00Z"}
    first = next(r for r in sf if r["price_at"] == "2026-11-22T08:00:00Z")
    assert first["end_price"] == 11.0 and first["step"] == 3 and first["sum_enhance_count"] == 5
    assert all("cube_sub_type" in r and "item_upgrade" not in r for r in cube)

    cap = capsys.readouterr()
    summary = json.loads(cap.out.strip().splitlines()[-1])
    assert summary["rowsSf"] == 3 and summary["rowsCube"] == 2
    assert summary["gzipBytes"] == out.stat().st_size
    assert "sf=3 cube=2" in cap.err and len(cap.err.strip().splitlines()) == 1


def test_export_empty_window_is_valid_empty_gzip(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    _seed(db_path)
    out = tmp_path / "inc.jsonl.gz"
    rc = export_increment.main(["--db", str(db_path), "--out", str(out), "--now", "2027-06-01T00:00:00Z"])
    assert rc == 0
    assert _read(out) == []


def test_export_is_read_only_and_does_not_touch_db(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    _seed(db_path)
    conn = db.connect(db_path)
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    before = db_path.read_bytes()

    export_increment.main(["--db", str(db_path), "--out", str(tmp_path / "o.gz"), "--now", NOW])
    assert db_path.read_bytes() == before

    ro = export_increment.open_readonly(db_path)
    try:
        try:
            ro.execute("DELETE FROM sf_price_history_hourly")
            raised = False
        except Exception:
            raised = True
        assert raised
    finally:
        ro.close()


def test_export_to_stdout_buffer_is_gzip(tmp_path: Path) -> None:
    db_path = tmp_path / "x.sqlite"
    _seed(db_path)
    conn = export_increment.open_readonly(db_path)
    buf = io.BytesIO()
    summary = export_increment.export(conn, buf, since="2026-11-22T08:00:00Z")
    conn.close()
    lines = gzip.decompress(buf.getvalue()).decode("utf-8").splitlines()
    assert summary["rowsSf"] + summary["rowsCube"] == len(lines) == 5
