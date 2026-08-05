"""SH-2 §5: resumable backfill of 28 equipment x itemUpgrade 0..21 (22 stars)
x ~150 days of 1-hour history.

Resumable: on startup, reads ``sf_history_backfill_progress`` for
``status='done'`` combinations and skips them (IMPL_PLAN_SH2 §5/§6(d)). Every
HTTP request goes through ``fetcher.Fetcher`` (rate limit + 429 backoff +
budget). Each (item, upgrade) combination is written to SQLite immediately
after it is fetched -- not buffered until the whole run finishes.

itemUpgrade 22 is intentionally NOT fetched (plan §5: the tool's ceiling is
reaching 22 stars, so the last price needed is the 21->22 step, itemUpgrade=21).

Usage:
    python scripts/backfill.py                       # full run (resumable)
    python scripts/backfill.py --limit 5              # smoke test / demo
    python scripts/backfill.py --db data/x.sqlite --items data/x.json
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db  # noqa: E402
import fetcher as fetcher_mod  # noqa: E402

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "sf_price_history.sqlite"
DEFAULT_ITEMS_PATH = Path(__file__).resolve().parent.parent / "data" / "sf_history_items.json"

WINDOW_DAYS = 160.0  # >149.7 days observed max retention (SH-1 M3), with headroom
MIN_UPGRADE = 0
MAX_UPGRADE = 21  # inclusive. 22 is out of scope (plan §5).


class BadEndPriceError(RuntimeError):
    """end_price null/negative encountered -- plan §7 stop condition 5."""


def load_items(items_path: Path) -> list[dict[str, Any]]:
    payload = json.loads(Path(items_path).read_text(encoding="utf-8"))
    return payload["items"]


def iter_combinations(items: list[dict[str, Any]]) -> list[tuple[int, int]]:
    combos: list[tuple[int, int]] = []
    for item in items:
        item_id = int(item["itemId"])
        for upgrade in range(MIN_UPGRADE, MAX_UPGRADE + 1):
            combos.append((item_id, upgrade))
    return combos


def _validate_points(points: list[dict[str, Any]], *, item_id: int, item_upgrade: int) -> None:
    """Raise if any point has a null/negative end_price (plan §7 condition 5).

    This column is written unconverted (schema.sql), so a null/negative
    value here means the API's own unit assumption broke, not a bug in our
    conversion -- there is no conversion to have a bug in.
    """
    bad = [p for p in points if p.get("endPrice") is None or p.get("endPrice") < 0]
    if bad:
        raise BadEndPriceError(
            f"item_id={item_id} item_upgrade={item_upgrade}: "
            f"{len(bad)} point(s) with null/negative endPrice, e.g. {bad[0]!r}"
        )


def run_backfill(
    *,
    db_path: Path,
    items_path: Path,
    limit: int | None,
    max_requests: int,
) -> dict[str, Any]:
    items = load_items(items_path)
    combos = iter_combinations(items)

    conn = db.connect(db_path)
    db.apply_schema(conn)
    done = db.load_done_combinations(conn)

    pending = [combo for combo in combos if combo not in done]
    if limit is not None:
        pending = pending[:limit]

    ftr = fetcher_mod.Fetcher(max_requests=max_requests)
    processed = 0
    stop_reason: str | None = None
    combo_errors: list[dict[str, Any]] = []

    try:
        for item_id, item_upgrade in pending:
            fetched_at = datetime.now(timezone.utc).isoformat()
            status, payload = fetcher_mod.fetch_history_page(
                ftr,
                item_id,
                item_upgrade=item_upgrade,
                window_days=WINDOW_DAYS,
                note=f"backfill item={item_id} upgrade={item_upgrade}",
            )

            if status != 200 or payload is None:
                db.record_progress(
                    conn,
                    item_id,
                    item_upgrade,
                    status="error",
                    row_count=0,
                    oldest_at=None,
                    newest_at=None,
                    updated_at=fetched_at,
                    note=f"http_status={status}",
                )
                combo_errors.append({"itemId": item_id, "itemUpgrade": item_upgrade, "httpStatus": status})
                processed += 1
                continue

            points = payload.get("points") or []
            _validate_points(points, item_id=item_id, item_upgrade=item_upgrade)

            row_count = db.upsert_hourly_rows(conn, item_id, item_upgrade, points, fetched_at)
            dates = [p.get("date") for p in points if p.get("date")]
            db.record_progress(
                conn,
                item_id,
                item_upgrade,
                status="done",
                row_count=row_count,
                oldest_at=min(dates) if dates else None,
                newest_at=max(dates) if dates else None,
                updated_at=fetched_at,
                note=None,
            )
            processed += 1
    except (
        fetcher_mod.RequestBudgetExceededError,
        fetcher_mod.ConsecutiveTooManyRequestsError,
        fetcher_mod.TotalTooManyRequestsExceededError,
    ) as exc:
        stop_reason = f"{type(exc).__name__}: {exc}"
        print(f"STOPPING: {stop_reason}", file=sys.stderr)
    finally:
        conn.close()

    return {
        "pending_at_start": len(pending),
        "processed": processed,
        "requests_made": ftr.total_requests,
        "total_429": ftr.total_429,
        "combo_errors": combo_errors,
        "stop_reason": stop_reason,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--items", type=Path, default=DEFAULT_ITEMS_PATH)
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process at most N pending (item, itemUpgrade) combinations "
        "(smoke tests / resumability demo, plan §5).",
    )
    parser.add_argument(
        "--max-requests", type=int, default=fetcher_mod.DEFAULT_MAX_REQUESTS
    )
    args = parser.parse_args()

    try:
        result = run_backfill(
            db_path=args.db,
            items_path=args.items,
            limit=args.limit,
            max_requests=args.max_requests,
        )
    except BadEndPriceError as exc:
        print(f"STOPPED (plan §7 condition 5): {exc}", file=sys.stderr)
        return 5

    print(json.dumps(result, indent=1, ensure_ascii=False))
    return 0 if result["stop_reason"] is None else 2


if __name__ == "__main__":
    raise SystemExit(main())
