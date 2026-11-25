"""SH47: VPS-side append of a gzip JSONL increment (see export_increment.py).

Reads the file from ``--file`` or stdin and appends it with ``INSERT OR IGNORE``:
rows already present are NEVER modified (no REPLACE / UPDATE / DELETE of hourly
rows). Then the 4h tables are re-derived for the combos present in the file via
``aggregate.update_combo_incremental`` / ``cube_aggregate.update_combo_incremental``
(the same functions update.py uses; no derivation rule lives here).

Re-deriving every combo in the file (not only combos that gained a row) is
deliberate: if a previous run died between the hourly commit and the 4h
re-derivation, re-sending the same file heals the 4h tables even though it
inserts 0 hourly rows. Re-deriving unchanged hourly data is a no-op by
construction (same input -> same 4h rows).

All-or-nothing for the hourly insert: a malformed line aborts with exit 2 and
rolls everything back. ``PRAGMA integrity_check`` runs BEFORE the insert (abort
with exit 3 if not ok) and AFTER it.

stdout carries exactly ONE JSON line (the PC driver parses it); logs go to stderr:
    {"insertedSf":N,"insertedCube":M,"combosTouched":K,"maxPriceAt":"...","integrity":"ok"}
``maxPriceAt`` is the newest price_at in the delivered file (all of it is in the
DB after a successful ingest).

Usage:
    python scripts/ingest_increment.py --db data/x.sqlite < increment.jsonl.gz
    python scripts/ingest_increment.py --db data/x.sqlite --file increment.jsonl.gz --backup
"""

from __future__ import annotations

import argparse
import gzip
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO, Iterator

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import aggregate  # noqa: E402
import cube_aggregate  # noqa: E402
import db  # noqa: E402

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "sf_price_history.sqlite"
VALUE_COLUMNS = ("step", "avg_price", "max_price", "min_price", "end_price", "sum_enhance_count", "fetched_at")
SECOND_KEY = {"sf": "item_upgrade", "cube": "cube_sub_type"}

INSERT_SQL = {
    "sf": (
        "INSERT OR IGNORE INTO sf_price_history_hourly "
        "(item_id, item_upgrade, price_at, step, avg_price, max_price, min_price, end_price, "
        "sum_enhance_count, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ),
    "cube": (
        "INSERT OR IGNORE INTO sf_cube_price_history_hourly "
        "(item_id, cube_sub_type, price_at, step, avg_price, max_price, min_price, end_price, "
        "sum_enhance_count, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ),
}


class IngestError(Exception):
    """Malformed input (exit 2)."""


def parse_record(line_no: int, text: str) -> tuple[str, tuple[Any, ...]]:
    try:
        rec = json.loads(text)
        kind = rec["t"]
        second = SECOND_KEY[kind]
        item_id = rec["item_id"]
        key2 = rec[second]
        price_at = rec["price_at"]
        end_price = rec["end_price"]
        values = [rec.get(col) for col in VALUE_COLUMNS]
    except (ValueError, KeyError, TypeError) as exc:
        raise IngestError(f"line {line_no}: malformed record ({type(exc).__name__}: {exc})") from exc
    if not isinstance(item_id, int) or isinstance(item_id, bool):
        raise IngestError(f"line {line_no}: item_id must be an integer")
    if kind == "sf" and (not isinstance(key2, int) or isinstance(key2, bool)):
        raise IngestError(f"line {line_no}: item_upgrade must be an integer")
    if kind == "cube" and not isinstance(key2, str):
        raise IngestError(f"line {line_no}: cube_sub_type must be a string")
    if not isinstance(price_at, str) or not (len(price_at) == 20 and price_at.endswith("Z")):
        raise IngestError(f"line {line_no}: price_at must be ISO8601 UTC 'YYYY-MM-DDTHH:MM:SSZ'")
    if end_price is None or isinstance(end_price, bool) or not isinstance(end_price, (int, float)):
        raise IngestError(f"line {line_no}: end_price must be a number")
    if values[VALUE_COLUMNS.index("sum_enhance_count")] is None:
        values[VALUE_COLUMNS.index("sum_enhance_count")] = 0
    if values[VALUE_COLUMNS.index("fetched_at")] is None:
        raise IngestError(f"line {line_no}: fetched_at missing")
    return kind, (item_id, key2, price_at, *values)


def iter_lines(stream: BinaryIO) -> Iterator[str]:
    with gzip.GzipFile(fileobj=stream, mode="rb") as gz:
        for raw in gz:
            text = raw.decode("utf-8").strip()
            if text:
                yield text


def integrity_ok(conn: sqlite3.Connection) -> bool:
    rows = conn.execute("PRAGMA integrity_check").fetchall()
    return len(rows) == 1 and rows[0][0] == "ok"


def backup_db(conn: sqlite3.Connection, db_path: Path, *, stamp: str, keep: int) -> Path:
    """Consistent snapshot to ``<db>.pre-ingest-<stamp>``; prune older ones beyond ``keep``."""
    dest = db_path.with_name(f"{db_path.name}.pre-ingest-{stamp}")
    target = sqlite3.connect(str(dest))
    try:
        conn.backup(target)
    finally:
        target.close()
    old = sorted(db_path.parent.glob(f"{db_path.name}.pre-ingest-*"))
    for stale in old[:-keep] if keep > 0 else []:
        stale.unlink()
    return dest


def ingest(
    conn: sqlite3.Connection, lines: Iterator[str], *, now: datetime, generated_at: str
) -> dict[str, Any]:
    inserted = {"sf": 0, "cube": 0}
    combos: dict[str, set[tuple[int, Any]]] = {"sf": set(), "cube": set()}
    max_price_at: str | None = None
    try:
        for line_no, text in enumerate(lines, start=1):
            kind, params = parse_record(line_no, text)
            cur = conn.execute(INSERT_SQL[kind], params)
            inserted[kind] += cur.rowcount if cur.rowcount > 0 else 0
            combos[kind].add((params[0], params[1]))
            if max_price_at is None or params[2] > max_price_at:
                max_price_at = params[2]
        conn.commit()
    except BaseException:
        conn.rollback()
        raise

    for item_id, upgrade in sorted(combos["sf"]):
        aggregate.update_combo_incremental(conn, item_id, upgrade, now=now, generated_at=generated_at)
    for item_id, sub in sorted(combos["cube"]):
        cube_aggregate.update_combo_incremental(conn, item_id, sub, now=now, generated_at=generated_at)

    return {
        "insertedSf": inserted["sf"],
        "insertedCube": inserted["cube"],
        "combosTouched": len(combos["sf"]) + len(combos["cube"]),
        "maxPriceAt": max_price_at,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--file", type=Path, default=None, help="gzip JSONL path (default: stdin)")
    parser.add_argument("--now", default=None, help="pin 'now' (ISO8601 UTC) for 4h derivation (tests)")
    parser.add_argument("--backup", action="store_true", help="snapshot the DB to <db>.pre-ingest-<ts> before inserting")
    parser.add_argument("--backup-keep", type=int, default=1, help="how many pre-ingest snapshots to keep (default 1)")
    args = parser.parse_args(argv)

    now = aggregate.parse_iso_utc(args.now) if args.now else datetime.now(timezone.utc)
    generated_at = aggregate.format_iso_utc(now)
    if not args.db.is_file():
        print(f"sf-history ingest: DB not found: {args.db}", file=sys.stderr)
        return 3

    conn = db.connect(args.db)
    try:
        if not integrity_ok(conn):
            print("sf-history ingest: integrity_check FAILED before insert; nothing written", file=sys.stderr)
            return 3
        if args.backup:
            dest = backup_db(conn, args.db, stamp=now.strftime("%Y%m%dT%H%M%SZ"), keep=args.backup_keep)
            print(f"sf-history ingest: backup {dest}", file=sys.stderr)
        stream = open(args.file, "rb") if args.file else sys.stdin.buffer
        try:
            result = ingest(conn, iter_lines(stream), now=now, generated_at=generated_at)
        except (IngestError, OSError, EOFError, UnicodeDecodeError) as exc:
            print(f"sf-history ingest: FAILED, nothing inserted: {exc}", file=sys.stderr)
            return 2
        finally:
            if args.file:
                stream.close()
        ok = integrity_ok(conn)
        result["integrity"] = "ok" if ok else "FAILED"
    finally:
        conn.close()

    print(
        f"sf-history ingest: inserted sf={result['insertedSf']} cube={result['insertedCube']}, "
        f"combos={result['combosTouched']}, maxPriceAt={result['maxPriceAt']}, integrity={result['integrity']}",
        file=sys.stderr,
    )
    print(json.dumps(result, separators=(",", ":")))
    return 0 if ok else 3


if __name__ == "__main__":
    raise SystemExit(main())
