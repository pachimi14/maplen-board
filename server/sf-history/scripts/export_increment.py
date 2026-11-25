"""SH47: export the most recent N days of hourly price rows as gzip JSONL.

The home PC fetches the official API (the VPS is blocked, LULU-153) and ships
only the recent increment to the VPS, where ``ingest_increment.py`` appends it.

READ-ONLY: the DB is opened with ``mode=ro``; nothing is ever written to it.

Output: one JSON object per line, ``"t"`` identifies the table:
  ``"sf"``   -> sf_price_history_hourly       (key: item_id, item_upgrade)
  ``"cube"`` -> sf_cube_price_history_hourly  (key: item_id, cube_sub_type)
All other columns are copied verbatim (``end_price`` is never converted).

Usage:
    python scripts/export_increment.py --db data/x.sqlite --out increment.jsonl.gz
    python scripts/export_increment.py --days 10 --out -      # gzip bytes to stdout

With ``--out <file>`` a one-line JSON summary goes to stdout; the human log
line goes to stderr (1-2 lines, same manner as update.py).
"""

from __future__ import annotations

import argparse
import gzip
import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import aggregate  # noqa: E402

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "sf_price_history.sqlite"
DEFAULT_OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "increment.jsonl.gz"
DEFAULT_DAYS = 3.0

SF_TABLE = "sf_price_history_hourly"
CUBE_TABLE = "sf_cube_price_history_hourly"
VALUE_COLUMNS = ("step", "avg_price", "max_price", "min_price", "end_price", "sum_enhance_count", "fetched_at")
KINDS: dict[str, tuple[str, str]] = {
    # t -> (table, second key column)
    "sf": (SF_TABLE, "item_upgrade"),
    "cube": (CUBE_TABLE, "cube_sub_type"),
}


def open_readonly(db_path: Path | str) -> sqlite3.Connection:
    path = Path(db_path).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"DB not found: {path}")
    return sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)


def cutoff_iso(now: datetime, days: float) -> str:
    return aggregate.format_iso_utc(now - timedelta(days=days))


def iter_records(conn: sqlite3.Connection, since: str) -> Iterator[dict[str, Any]]:
    for kind, (table, second_key) in KINDS.items():
        cols = ("item_id", second_key, "price_at") + VALUE_COLUMNS
        cur = conn.execute(
            f"SELECT {', '.join(cols)} FROM {table} WHERE price_at >= ? "
            f"ORDER BY item_id, {second_key}, price_at",
            (since,),
        )
        for row in cur:
            record: dict[str, Any] = {"t": kind}
            record.update(zip(cols, row))
            yield record


def export(conn: sqlite3.Connection, fileobj, *, since: str) -> dict[str, Any]:
    """Write gzip JSONL to the binary ``fileobj``; return counts/bytes (uncompressed bytes in ``rawBytes``)."""
    counts = {"sf": 0, "cube": 0}
    raw_bytes = 0
    newest: str | None = None
    # mtime=0 keeps the gzip bytes reproducible for identical input.
    with gzip.GzipFile(fileobj=fileobj, mode="wb", mtime=0) as gz:
        for record in iter_records(conn, since):
            line = (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
            gz.write(line)
            raw_bytes += len(line)
            counts[record["t"]] += 1
            if newest is None or record["price_at"] > newest:
                newest = record["price_at"]
    return {"rowsSf": counts["sf"], "rowsCube": counts["cube"], "rawBytes": raw_bytes, "newestPriceAt": newest}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--out", default=str(DEFAULT_OUT_PATH), help="output .jsonl.gz path, or '-' for stdout")
    parser.add_argument("--days", type=float, default=DEFAULT_DAYS, help="export price_at >= now - DAYS (default 3)")
    parser.add_argument("--now", default=None, help="pin 'now' (ISO8601 UTC) for reproducible runs/tests")
    args = parser.parse_args(argv)

    now = aggregate.parse_iso_utc(args.now) if args.now else datetime.now(timezone.utc)
    since = cutoff_iso(now, args.days)
    conn = open_readonly(args.db)
    try:
        if args.out == "-":
            summary = export(conn, sys.stdout.buffer, since=since)
            gz_bytes = None
        else:
            out_path = Path(args.out)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = out_path.with_name(out_path.name + ".part")
            with open(tmp_path, "wb") as fh:
                summary = export(conn, fh, since=since)
            tmp_path.replace(out_path)
            gz_bytes = out_path.stat().st_size
    finally:
        conn.close()

    print(
        f"sf-history export: sf={summary['rowsSf']} cube={summary['rowsCube']} rows since {since}, "
        f"raw={summary['rawBytes']} B, gzip={gz_bytes if gz_bytes is not None else 'stdout'} B, "
        f"newest={summary['newestPriceAt']}",
        file=sys.stderr,
    )
    if args.out != "-":
        print(
            json.dumps(
                {
                    "out": str(args.out),
                    "since": since,
                    "rowsSf": summary["rowsSf"],
                    "rowsCube": summary["rowsCube"],
                    "gzipBytes": gz_bytes,
                    "newestPriceAt": summary["newestPriceAt"],
                },
                ensure_ascii=False,
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
