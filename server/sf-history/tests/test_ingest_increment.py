from __future__ import annotations

import gzip
import json
from datetime import datetime, timezone
from pathlib import Path

import aggregate
import cube_aggregate
import db
import export_increment
import ingest_increment

NOW = "2026-11-25T08:00:00Z"
NOW_DT = datetime(2026, 11, 25, 8, 0, tzinfo=timezone.utc)
FETCHED = "2026-11-25T00:00:00Z"


def _hours(day: str, hours, base: float) -> list[dict]:
    return [{"date": f"{day}T{h:02d}:00:00Z", "endPrice": base + h} for h in hours]


def _make_vps(path: Path) -> None:
    """VPS state: data up to 2026-11-24T03 (SF 1001 u0, u1; CUBE 2001 RED), 4h derived."""
    conn = db.connect(path)
    db.apply_schema(conn)
    db.upsert_hourly_rows(conn, 1001, 0, _hours("2026-11-24", range(0, 4), 100.0), FETCHED)
    db.upsert_hourly_rows(conn, 1001, 1, _hours("2026-11-24", range(0, 4), 200.0), FETCHED)
    db.upsert_cube_hourly_rows(conn, 2001, "RED", _hours("2026-11-24", range(0, 4), 300.0), FETCHED)
    aggregate.rebuild_all(conn, now=NOW_DT, generated_at=FETCHED)
    cube_aggregate.rebuild_all(conn, now=NOW_DT, generated_at=FETCHED)
    conn.close()


def _make_pc_increment(tmp_path: Path) -> Path:
    """PC state = VPS history + 2026-11-24T04..11 (hand-placed: SF u0 8 rows, u1 8 rows, CUBE 8 rows)."""
    pc = tmp_path / "pc.sqlite"
    _make_vps(pc)
    conn = db.connect(pc)
    db.upsert_hourly_rows(conn, 1001, 0, _hours("2026-11-24", range(4, 12), 100.0), FETCHED)
    db.upsert_hourly_rows(conn, 1001, 1, _hours("2026-11-24", range(4, 12), 200.0), FETCHED)
    db.upsert_cube_hourly_rows(conn, 2001, "RED", _hours("2026-11-24", range(4, 12), 300.0), FETCHED)
    conn.close()
    out = tmp_path / "inc.jsonl.gz"
    # --days 2 from 11-25T08 -> cutoff 11-23T08: the file holds hours 00..11 of 11-24 (12 per combo)
    export_increment.main(["--db", str(pc), "--out", str(out), "--now", NOW, "--days", "2"])
    return out


def _snapshot_4h(path: Path) -> list[tuple]:
    conn = db.connect(path)
    rows = conn.execute(
        "SELECT 'sf', item_id, item_upgrade, price_at, end_price, source_hour_at FROM sf_price_history_4h "
        "UNION ALL SELECT 'cube', item_id, cube_sub_type, price_at, end_price, source_hour_at "
        "FROM sf_cube_price_history_4h ORDER BY 1, 2, 3, 4"
    ).fetchall()
    conn.close()
    return rows


def _run(db_path: Path, inc: Path, capsys) -> dict:
    capsys.readouterr()  # drop anything printed while building the fixture
    rc = ingest_increment.main(["--db", str(db_path), "--file", str(inc), "--now", NOW])
    assert rc == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert len(out) == 1  # stdout is exactly one JSON line
    return json.loads(out[0])


def test_normal_ingest_inserts_known_counts_and_rederives_4h(tmp_path: Path, capsys) -> None:
    vps = tmp_path / "vps.sqlite"
    _make_vps(vps)
    inc = _make_pc_increment(tmp_path)

    # File rows per combo = hours 0..11 (12); VPS already has 00..03, so 8 are new per combo.
    # Two SF combos (8 each = 16) + 1 CUBE combo (8).
    result = _run(vps, inc, capsys)
    assert result["insertedSf"] == 16
    assert result["insertedCube"] == 8
    assert result["combosTouched"] == 3
    assert result["maxPriceAt"] == "2026-11-24T11:00:00Z"
    assert result["integrity"] == "ok"

    conn = db.connect(vps)
    assert db.count_hourly_rows(conn) == 2 * 12
    assert db.count_cube_hourly_rows(conn) == 12
    conn.close()

    # Buckets 04:00 and 08:00 (11-24) completed (NOW is 11-25) -> must now exist, taking the LAST hour.
    snap = {(k, i, u, p): (e, s) for k, i, u, p, e, s in _snapshot_4h(vps)}
    assert snap[("sf", 1001, 0, "2026-11-24T04:00:00Z")] == (107.0, "2026-11-24T07:00:00Z")
    assert snap[("sf", 1001, 0, "2026-11-24T08:00:00Z")] == (111.0, "2026-11-24T11:00:00Z")
    assert snap[("cube", 2001, "RED", "2026-11-24T08:00:00Z")] == (311.0, "2026-11-24T11:00:00Z")


def test_double_ingest_is_idempotent(tmp_path: Path, capsys) -> None:
    vps = tmp_path / "vps.sqlite"
    _make_vps(vps)
    inc = _make_pc_increment(tmp_path)

    first = _run(vps, inc, capsys)
    after_first = _snapshot_4h(vps)
    conn = db.connect(vps)
    hourly_first = conn.execute("SELECT * FROM sf_price_history_hourly ORDER BY 1,2,3").fetchall()
    conn.close()
    assert first["insertedSf"] == 16 and first["insertedCube"] == 8

    second = _run(vps, inc, capsys)
    assert second["insertedSf"] == 0
    assert second["insertedCube"] == 0
    assert second["integrity"] == "ok"
    assert _snapshot_4h(vps) == after_first  # every 4h row (incl. end_price) identical
    conn = db.connect(vps)
    assert conn.execute("SELECT * FROM sf_price_history_hourly ORDER BY 1,2,3").fetchall() == hourly_first
    conn.close()


def test_4h_after_ingest_equals_full_rebuild(tmp_path: Path, capsys) -> None:
    vps = tmp_path / "vps.sqlite"
    _make_vps(vps)
    _run(vps, _make_pc_increment(tmp_path), capsys)
    incremental = _snapshot_4h(vps)

    conn = db.connect(vps)
    aggregate.rebuild_all(conn, now=NOW_DT, generated_at=FETCHED)
    cube_aggregate.rebuild_all(conn, now=NOW_DT, generated_at=FETCHED)
    conn.close()
    assert _snapshot_4h(vps) == incremental


def test_existing_hourly_rows_are_never_overwritten(tmp_path: Path, capsys) -> None:
    vps = tmp_path / "vps.sqlite"
    _make_vps(vps)
    inc = tmp_path / "evil.jsonl.gz"
    rec = {"t": "sf", "item_id": 1001, "item_upgrade": 0, "price_at": "2026-11-24T00:00:00Z",
           "step": None, "avg_price": None, "max_price": None, "min_price": None,
           "end_price": 999999.0, "sum_enhance_count": 77, "fetched_at": "2099-01-01T00:00:00Z"}
    with gzip.open(inc, "wt", encoding="utf-8") as fh:
        fh.write(json.dumps(rec) + "\n")
    result = _run(vps, inc, capsys)
    assert result["insertedSf"] == 0
    conn = db.connect(vps)
    row = conn.execute(
        "SELECT end_price, sum_enhance_count, fetched_at FROM sf_price_history_hourly "
        "WHERE item_id=1001 AND item_upgrade=0 AND price_at='2026-11-24T00:00:00Z'"
    ).fetchone()
    conn.close()
    assert row == (100.0, 0, FETCHED)


def test_empty_file_inserts_nothing(tmp_path: Path, capsys) -> None:
    vps = tmp_path / "vps.sqlite"
    _make_vps(vps)
    before = _snapshot_4h(vps)
    inc = tmp_path / "empty.jsonl.gz"
    with gzip.open(inc, "wt", encoding="utf-8"):
        pass
    result = _run(vps, inc, capsys)
    assert result == {"insertedSf": 0, "insertedCube": 0, "combosTouched": 0, "maxPriceAt": None, "integrity": "ok"}
    assert _snapshot_4h(vps) == before


def test_malformed_line_rolls_back_everything(tmp_path: Path, capsys) -> None:
    vps = tmp_path / "vps.sqlite"
    _make_vps(vps)
    good = {"t": "sf", "item_id": 1001, "item_upgrade": 0, "price_at": "2026-11-24T04:00:00Z",
            "step": None, "avg_price": None, "max_price": None, "min_price": None,
            "end_price": 1.0, "sum_enhance_count": 0, "fetched_at": FETCHED}
    inc = tmp_path / "bad.jsonl.gz"
    with gzip.open(inc, "wt", encoding="utf-8") as fh:
        fh.write(json.dumps(good) + "\n")
        fh.write('{"t":"sf","item_id":1001}\n')
    rc = ingest_increment.main(["--db", str(vps), "--file", str(inc), "--now", NOW])
    assert rc == 2
    assert capsys.readouterr().out == ""  # no JSON on failure
    conn = db.connect(vps)
    assert db.count_hourly_rows(conn) == 8  # unchanged: the good first line was rolled back too
    conn.close()


def test_reads_stdin_and_default_backup_snapshot_pruned(tmp_path: Path, capsys, monkeypatch) -> None:
    import io
    import sys

    vps = tmp_path / "vps.sqlite"
    _make_vps(vps)
    inc = _make_pc_increment(tmp_path)
    old = tmp_path / "vps.sqlite.pre-ingest-20200101T000000Z"
    old.write_bytes(b"stale")

    class _Stdin:
        buffer = io.BytesIO(inc.read_bytes())

    monkeypatch.setattr(sys, "stdin", _Stdin)
    capsys.readouterr()
    rc = ingest_increment.main(["--db", str(vps), "--now", NOW])
    assert rc == 0
    assert json.loads(capsys.readouterr().out)["insertedSf"] == 16
    snaps = sorted(p.name for p in tmp_path.glob("vps.sqlite.pre-ingest-*"))
    assert snaps == ["vps.sqlite.pre-ingest-20261125T080000Z"]  # new one kept, stale pruned
    snap_conn = db.connect(tmp_path / snaps[0])
    assert db.count_hourly_rows(snap_conn) == 8  # snapshot is the PRE-ingest state
    snap_conn.close()


def test_snapshot_taken_by_default_and_skipped_with_no_backup(tmp_path: Path, capsys) -> None:
    inc = _make_pc_increment(tmp_path)
    a = tmp_path / "a.sqlite"
    _make_vps(a)
    assert ingest_increment.main(["--db", str(a), "--file", str(inc), "--now", NOW]) == 0  # no backup flag
    assert len(list(tmp_path.glob("a.sqlite.pre-ingest-*"))) == 1

    b = tmp_path / "b.sqlite"
    _make_vps(b)
    assert ingest_increment.main(["--db", str(b), "--file", str(inc), "--now", NOW, "--no-backup"]) == 0
    assert list(tmp_path.glob("b.sqlite.pre-ingest-*")) == []
