"""IMPL_PLAN_SH39 §4 (B): resumable backfill of the 4 CUBE sub-types
(RED / BLACK / ADDITIONAL / WHITE_ADDITIONAL, plan §1 -- ``cube.
CUBE_SUB_TYPES``) x 34 equipment x ~160 days of 1-hour CUBE price history
(I5: 34 x 4 = 136 combinations).

A standalone script, NOT a refactor of ``scripts/backfill.py`` (plan §4:
"既存の scripts/backfill.py を壊さない...新規スクリプトにするか...は実装
担当の裁量" -- a separate script means backfill.py's own behavior cannot be
touched even accidentally, satisfying "既存の挙動は1ビットも変えない" by
construction). Same resumability / rate-limit / null-price-validation
discipline as ``backfill.py``, adapted for the CUBE series key
``(item_id, cube_sub_type)`` instead of ``(item_id, item_upgrade)`` -- see
``db.py``'s ``sf_cube_*`` functions and ``fetcher.
fetch_prospective_history_page``.

itemUpgrade is not part of this series key at all (plan §0 I4: a cube has no
star concept -- ``fetch_prospective_history_page`` always sends
``itemUpgrade=0``).

★統括が実行する。実装担当はこのスクリプトを実行しない(plan §4/§10)。

Usage:
    python scripts/cube_backfill.py                       # full run (resumable)
    python scripts/cube_backfill.py --limit 5              # smoke test / demo
    python scripts/cube_backfill.py --db data/x.sqlite --items data/x.json
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cube  # noqa: E402
import db  # noqa: E402
import fetcher as fetcher_mod  # noqa: E402

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "sf_price_history.sqlite"
DEFAULT_ITEMS_PATH = Path(__file__).resolve().parent.parent / "data" / "sf_history_items.json"

WINDOW_DAYS = 160.0  # same window as scripts/backfill.py's WINDOW_DAYS


class BadEndPriceError(RuntimeError):
    """end_price null/negative encountered -- same stop condition as backfill.py."""


def load_items(items_path: Path) -> list[dict[str, Any]]:
    payload = json.loads(Path(items_path).read_text(encoding="utf-8"))
    return payload["items"]


def iter_combinations(items: list[dict[str, Any]]) -> list[tuple[int, str]]:
    """(item_id, cube_sub_type) for every item x every ``cube.CUBE_SUB_TYPES``
    entry -- 34 items x 4 sub-types = 136 (plan §8 accept criterion (b))."""
    combos: list[tuple[int, str]] = []
    for item in items:
        item_id = int(item["itemId"])
        for cube_sub_type in cube.CUBE_SUB_TYPES:
            combos.append((item_id, cube_sub_type))
    return combos


def _validate_points(points: list[dict[str, Any]], *, item_id: int, cube_sub_type: str) -> None:
    """Raise if any point has a null/negative end_price (mirrors backfill.py's
    ``_validate_points`` -- this column is written unconverted, same as SF's)."""
    bad = [p for p in points if p.get("endPrice") is None or p.get("endPrice") < 0]
    if bad:
        raise BadEndPriceError(
            f"item_id={item_id} cube_sub_type={cube_sub_type}: "
            f"{len(bad)} point(s) with null/negative endPrice, e.g. {bad[0]!r}"
        )


def run_cube_backfill(
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
    done = db.load_done_cube_combinations(conn)

    pending = [combo for combo in combos if combo not in done]
    if limit is not None:
        pending = pending[:limit]

    ftr = fetcher_mod.Fetcher(max_requests=max_requests)
    processed = 0
    stop_reason: str | None = None
    combo_errors: list[dict[str, Any]] = []

    try:
        for item_id, cube_sub_type in pending:
            fetched_at = datetime.now(timezone.utc).isoformat()
            status, payload = fetcher_mod.fetch_prospective_history_page(
                ftr,
                item_id,
                cube_sub_type=cube_sub_type,
                window_days=WINDOW_DAYS,
                note=f"cube_backfill item={item_id} cube_sub_type={cube_sub_type}",
            )

            if status != 200 or payload is None:
                db.record_cube_progress(
                    conn,
                    item_id,
                    cube_sub_type,
                    status="error",
                    row_count=0,
                    oldest_at=None,
                    newest_at=None,
                    updated_at=fetched_at,
                    note=f"http_status={status}",
                )
                combo_errors.append(
                    {"itemId": item_id, "cubeSubType": cube_sub_type, "httpStatus": status}
                )
                processed += 1
                continue

            points = payload.get("points") or []
            _validate_points(points, item_id=item_id, cube_sub_type=cube_sub_type)

            row_count = db.upsert_cube_hourly_rows(conn, item_id, cube_sub_type, points, fetched_at)
            dates = [p.get("date") for p in points if p.get("date")]
            db.record_cube_progress(
                conn,
                item_id,
                cube_sub_type,
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
        help="Process at most N pending (item, cube_sub_type) combinations "
        "(smoke tests / resumability demo).",
    )
    parser.add_argument(
        "--max-requests", type=int, default=fetcher_mod.DEFAULT_MAX_REQUESTS
    )
    args = parser.parse_args()

    try:
        result = run_cube_backfill(
            db_path=args.db,
            items_path=args.items,
            limit=args.limit,
            max_requests=args.max_requests,
        )
    except BadEndPriceError as exc:
        print(f"STOPPED (null/negative endPrice): {exc}", file=sys.stderr)
        return 5

    print(json.dumps(result, indent=1, ensure_ascii=False))
    return 0 if result["stop_reason"] is None else 2


if __name__ == "__main__":
    raise SystemExit(main())
