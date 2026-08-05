"""SH-3 §6: 4-hourly differential fetch + incremental 4h re-derivation.

Intended to run as a one-shot process under a systemd timer every 4 hours
(design §5.2: "ワンショット + timer" -- never a sleeping daemon; OPS-1's
lesson was a daemon that held a TTL-less cache and drove the VPS into swap).

For every (item_id, item_upgrade) combination already backfilled, fetches
[last saved price_at - 8h, now] and UPSERTs it (design §5.2: "API 側の遅延・
一時欠損・後から修正された値に耐える" -- the official API can revise recent
values), then re-derives only the 4h buckets that could have changed
(``aggregate.update_combo_incremental``) rather than a full rebuild (plan §6:
"全再生成でなく差分でよいが、全再生成した場合と同じ結果になることを (a) で
担保" -- see ``aggregate.update_combo_incremental``'s docstring for why that
equivalence holds).

Rate-limit discipline matches ``scripts/backfill.py``: every HTTP request
goes through ``fetcher.Fetcher`` (sequential, >=1s apart, 429 backoff, hard
stop at 3 consecutive 429s). Logging is 1-3 lines total per run (design §15).

Usage:
    python scripts/update.py
    python scripts/update.py --db data/x.sqlite --items data/x.json
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import aggregate  # noqa: E402
import db  # noqa: E402
import fetcher as fetcher_mod  # noqa: E402

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "sf_price_history.sqlite"
DEFAULT_ITEMS_PATH = Path(__file__).resolve().parent.parent / "data" / "sf_history_items.json"

LOOKBACK_HOURS = 8
MIN_UPGRADE = 0
MAX_UPGRADE = 21  # inclusive -- itemUpgrade 22 is out of scope (plan §8 condition 6)


def load_items(items_path: Path) -> list[dict[str, Any]]:
    payload = json.loads(Path(items_path).read_text(encoding="utf-8"))
    return payload["items"]


def iter_combinations(items: list[dict[str, Any]]) -> list[tuple[int, int]]:
    return [
        (int(item["itemId"]), upgrade)
        for item in items
        for upgrade in range(MIN_UPGRADE, MAX_UPGRADE + 1)
    ]


def _window_start(conn, item_id: int, item_upgrade: int, *, now: datetime) -> datetime:
    """The start of the fetch window: 8h before this combo's last saved hourly
    point, or (if it has never been backfilled) 8h before ``now``.
    """
    cur = conn.execute(
        "SELECT MAX(price_at) FROM sf_price_history_hourly WHERE item_id = ? AND item_upgrade = ?",
        (item_id, item_upgrade),
    )
    last = cur.fetchone()[0]
    if last is None:
        return now - timedelta(hours=LOOKBACK_HOURS)
    return aggregate.parse_iso_utc(last) - timedelta(hours=LOOKBACK_HOURS)


def run_update(
    *,
    db_path: Path,
    items_path: Path,
    max_requests: int = fetcher_mod.DEFAULT_MAX_REQUESTS,
    now: datetime | None = None,
) -> dict[str, Any]:
    if now is None:
        now = datetime.now(timezone.utc)

    items = load_items(items_path)
    combos = iter_combinations(items)

    conn = db.connect(db_path)
    db.apply_schema(conn)

    ftr = fetcher_mod.Fetcher(max_requests=max_requests)
    fetched_ok = 0
    fetched_error = 0
    hourly_rows_written = 0
    combo_errors: list[dict[str, Any]] = []
    stop_reason: str | None = None

    try:
        for item_id, item_upgrade in combos:
            window_start = _window_start(conn, item_id, item_upgrade, now=now)
            window_days = max((now - window_start).total_seconds() / 86400.0, 1.0 / 24)
            fetched_at = datetime.now(timezone.utc).isoformat()

            status, payload = fetcher_mod.fetch_history_page(
                ftr,
                item_id,
                item_upgrade=item_upgrade,
                window_days=window_days,
                note=f"update item={item_id} upgrade={item_upgrade}",
            )

            if status != 200 or payload is None:
                fetched_error += 1
                combo_errors.append({"itemId": item_id, "itemUpgrade": item_upgrade, "httpStatus": status})
                continue

            points = payload.get("points") or []
            if points:
                hourly_rows_written += db.upsert_hourly_rows(conn, item_id, item_upgrade, points, fetched_at)
            fetched_ok += 1

            generated_at = datetime.now(timezone.utc).isoformat()
            aggregate.update_combo_incremental(
                conn, item_id, item_upgrade, now=now, generated_at=generated_at
            )
    except (
        fetcher_mod.RequestBudgetExceededError,
        fetcher_mod.ConsecutiveTooManyRequestsError,
        fetcher_mod.TotalTooManyRequestsExceededError,
    ) as exc:
        stop_reason = f"{type(exc).__name__}: {exc}"
    finally:
        conn.close()

    return {
        "combos": len(combos),
        "fetchedOk": fetched_ok,
        "fetchedError": fetched_error,
        "hourlyRowsWritten": hourly_rows_written,
        "requestsMade": ftr.total_requests,
        "total429": ftr.total_429,
        "comboErrors": combo_errors,
        "stopReason": stop_reason,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--items", type=Path, default=DEFAULT_ITEMS_PATH)
    parser.add_argument("--max-requests", type=int, default=fetcher_mod.DEFAULT_MAX_REQUESTS)
    args = parser.parse_args()

    result = run_update(db_path=args.db, items_path=args.items, max_requests=args.max_requests)

    # design §15: 1-3 log lines per run (journald picks this up under the timer unit).
    print(
        f"sf-history update: {result['fetchedOk']}/{result['combos']} combos ok, "
        f"{result['hourlyRowsWritten']} hourly rows written, {result['requestsMade']} requests, "
        f"{result['total429']} x429, stop={result['stopReason']}",
        file=sys.stderr,
    )
    if result["comboErrors"]:
        print(f"sf-history update errors: {json.dumps(result['comboErrors'], ensure_ascii=False)}", file=sys.stderr)

    return 0 if result["stopReason"] is None else 2


if __name__ == "__main__":
    raise SystemExit(main())
