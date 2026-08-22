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
import cube  # noqa: E402
import cube_aggregate  # noqa: E402
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


# --- IMPL_PLAN_SH39 §6 (D): CUBE differential update, layered onto the same
# 4-hourly timer as the SF update above (no new timer -- plan §6: "新しい
# timer を増やさない"). Mirrors run_update/`_window_start` exactly, adapted
# for the CUBE series key (item_id, cube_sub_type) and cube_aggregate.py
# instead of aggregate.py.


def iter_cube_combinations(items: list[dict[str, Any]]) -> list[tuple[int, str]]:
    return [
        (int(item["itemId"]), cube_sub_type)
        for item in items
        for cube_sub_type in cube.CUBE_SUB_TYPES
    ]


def _cube_window_start(conn, item_id: int, cube_sub_type: str, *, now: datetime) -> datetime:
    """The CUBE counterpart of ``_window_start`` above -- same 8h-lookback
    rule, read from ``sf_cube_price_history_hourly`` instead."""
    cur = conn.execute(
        "SELECT MAX(price_at) FROM sf_cube_price_history_hourly WHERE item_id = ? AND cube_sub_type = ?",
        (item_id, cube_sub_type),
    )
    last = cur.fetchone()[0]
    if last is None:
        return now - timedelta(hours=LOOKBACK_HOURS)
    return aggregate.parse_iso_utc(last) - timedelta(hours=LOOKBACK_HOURS)


def run_cube_update(
    *,
    db_path: Path,
    items_path: Path,
    max_requests: int = fetcher_mod.DEFAULT_MAX_REQUESTS,
    now: datetime | None = None,
) -> dict[str, Any]:
    """CUBE counterpart of ``run_update`` -- same differential-fetch +
    incremental-4h-rederive shape, driven by ``fetcher.
    fetch_prospective_history_page`` / ``db.upsert_cube_hourly_rows`` /
    ``cube_aggregate.update_combo_incremental``. Uses its OWN ``Fetcher``
    instance (its own request budget), never sharing SF's -- so nothing
    about the CUBE run can affect SF's already-completed budget accounting
    (plan §8 accept criterion (f)).
    """
    if now is None:
        now = datetime.now(timezone.utc)

    items = load_items(items_path)
    combos = iter_cube_combinations(items)

    conn = db.connect(db_path)
    db.apply_schema(conn)

    ftr = fetcher_mod.Fetcher(max_requests=max_requests)
    fetched_ok = 0
    fetched_error = 0
    hourly_rows_written = 0
    combo_errors: list[dict[str, Any]] = []
    stop_reason: str | None = None

    try:
        for item_id, cube_sub_type in combos:
            window_start = _cube_window_start(conn, item_id, cube_sub_type, now=now)
            window_days = max((now - window_start).total_seconds() / 86400.0, 1.0 / 24)
            fetched_at = datetime.now(timezone.utc).isoformat()

            status, payload = fetcher_mod.fetch_prospective_history_page(
                ftr,
                item_id,
                cube_sub_type=cube_sub_type,
                window_days=window_days,
                note=f"cube_update item={item_id} cube_sub_type={cube_sub_type}",
            )

            if status != 200 or payload is None:
                fetched_error += 1
                combo_errors.append({"itemId": item_id, "cubeSubType": cube_sub_type, "httpStatus": status})
                continue

            points = payload.get("points") or []
            if points:
                hourly_rows_written += db.upsert_cube_hourly_rows(
                    conn, item_id, cube_sub_type, points, fetched_at
                )
            fetched_ok += 1

            generated_at = datetime.now(timezone.utc).isoformat()
            cube_aggregate.update_combo_incremental(
                conn, item_id, cube_sub_type, now=now, generated_at=generated_at
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


def run_all(
    *,
    db_path: Path,
    items_path: Path,
    max_requests: int = fetcher_mod.DEFAULT_MAX_REQUESTS,
    now: datetime | None = None,
) -> dict[str, Any]:
    """SH-39 plan §6 (D): SF's differential update runs to completion FIRST,
    then CUBE's -- and a CUBE-side failure, including an exception this
    module did not itself anticipate, must never retroactively affect the
    already-computed/returned SF result (accept criterion (f): "SF が先・
    キューブが後。キューブ失敗時も SF は完了する"). The broad ``except
    Exception`` below is deliberate: SF's own error handling only catches the
    3 ``fetcher`` budget/429 exceptions (real HTTP failures already surface
    as ``comboErrors`` with ``stopReason=None``), but the CUBE step must be
    defended against ANY exception, expected or not, without ever
    propagating past this function and aborting the (already-finished) SF
    result.

    Returns ``{"sf": <run_update() result>, "cube": <run_cube_update()
    result, or None if it raised>, "cubeError": <str, or None>}``.
    """
    sf_result = run_update(db_path=db_path, items_path=items_path, max_requests=max_requests, now=now)

    cube_result: dict[str, Any] | None = None
    cube_error: str | None = None
    try:
        cube_result = run_cube_update(
            db_path=db_path, items_path=items_path, max_requests=max_requests, now=now
        )
    except Exception as exc:  # noqa: BLE001 -- deliberately broad, see docstring above
        cube_error = f"{type(exc).__name__}: {exc}"

    return {"sf": sf_result, "cube": cube_result, "cubeError": cube_error}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--items", type=Path, default=DEFAULT_ITEMS_PATH)
    parser.add_argument("--max-requests", type=int, default=fetcher_mod.DEFAULT_MAX_REQUESTS)
    args = parser.parse_args()

    combined = run_all(db_path=args.db, items_path=args.items, max_requests=args.max_requests)
    result = combined["sf"]

    # design §15: 1-3 log lines per run (journald picks this up under the timer unit).
    print(
        f"sf-history update: {result['fetchedOk']}/{result['combos']} combos ok, "
        f"{result['hourlyRowsWritten']} hourly rows written, {result['requestsMade']} requests, "
        f"{result['total429']} x429, stop={result['stopReason']}",
        file=sys.stderr,
    )
    if result["comboErrors"]:
        print(f"sf-history update errors: {json.dumps(result['comboErrors'], ensure_ascii=False)}", file=sys.stderr)

    cube_result = combined["cube"]
    if cube_result is not None:
        print(
            f"sf-history cube update: {cube_result['fetchedOk']}/{cube_result['combos']} combos ok, "
            f"{cube_result['hourlyRowsWritten']} hourly rows written, {cube_result['requestsMade']} requests, "
            f"{cube_result['total429']} x429, stop={cube_result['stopReason']}",
            file=sys.stderr,
        )
        if cube_result["comboErrors"]:
            print(
                f"sf-history cube update errors: {json.dumps(cube_result['comboErrors'], ensure_ascii=False)}",
                file=sys.stderr,
            )
    else:
        print(f"sf-history cube update: FAILED unexpectedly: {combined['cubeError']}", file=sys.stderr)

    if result["stopReason"] is not None:
        return 2  # SF failure keeps its existing exit code (pre-SH-39 meaning unchanged)
    if cube_result is None or cube_result["stopReason"] is not None:
        return 3  # CUBE-only failure: distinct code so it is never mistaken for an SF failure
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
