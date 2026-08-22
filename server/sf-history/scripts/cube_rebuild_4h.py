"""IMPL_PLAN_SH39 §5 (C): full 4h rebuild from ``sf_cube_price_history_hourly``.

The CUBE counterpart of ``scripts/rebuild_4h.py`` -- same determinism
harness shape (running it twice against the same hourly data must produce a
``sf_cube_price_history_4h`` table whose ``cube_aggregate.content_hash`` is
identical both times), driven by ``cube_aggregate.rebuild_all`` instead of
``aggregate.rebuild_all``.

Usage:
    python scripts/cube_rebuild_4h.py
    python scripts/cube_rebuild_4h.py --db data/x.sqlite
    python scripts/cube_rebuild_4h.py --now 2026-08-05T12:00:00Z   # pin "now"
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import aggregate  # noqa: E402
import cube_aggregate  # noqa: E402
import db  # noqa: E402

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "sf_price_history.sqlite"


def run_rebuild(db_path: Path, *, now: datetime | None = None) -> dict:
    conn = db.connect(db_path)
    db.apply_schema(conn)
    try:
        result = cube_aggregate.rebuild_all(conn, now=now)
        result["contentHash"] = cube_aggregate.content_hash(conn)
        result["rowsInTable"] = db.count_cube_4h_rows(conn)
    finally:
        conn.close()
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument(
        "--now", type=str, default=None, help="ISO8601 UTC override, for determinism testing."
    )
    args = parser.parse_args()

    now = aggregate.parse_iso_utc(args.now) if args.now else datetime.now(timezone.utc)
    result = run_rebuild(args.db, now=now)

    print(json.dumps(result, indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
