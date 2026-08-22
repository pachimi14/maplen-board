"""SQLite access for the SF price history backfill (SH-2).

Schema: ``schema.sql``. This module only reads/writes
``sf_price_history_hourly`` and ``sf_history_backfill_progress`` -- it never
touches anything outside the DB file it is given.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Iterable

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"


def connect(db_path: Path | str) -> sqlite3.Connection:
    """Open (creating if needed) the SQLite DB at ``db_path``."""
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def apply_schema(conn: sqlite3.Connection, schema_path: Path = SCHEMA_PATH) -> None:
    """Idempotently create the tables (CREATE TABLE IF NOT EXISTS)."""
    sql = Path(schema_path).read_text(encoding="utf-8")
    conn.executescript(sql)
    conn.commit()


def upsert_hourly_rows(
    conn: sqlite3.Connection,
    item_id: int,
    item_upgrade: int,
    points: Iterable[dict[str, Any]],
    fetched_at: str,
) -> int:
    """UPSERT one (item_id, item_upgrade) combo's history points.

    Writes immediately (single transaction per call, committed before
    returning) rather than buffering across combinations -- IMPL_PLAN_SH2 §5:
    "1件ずつ即座に SQLite へ書く。全部終わってからまとめて書かない".
    ``end_price`` is taken from the API's ``endPrice`` unconverted (schema.sql
    comment / IMPL_PLAN_SH2 §3): no unit conversion happens in this function.

    Returns the number of rows written (== len(points)).
    """
    rows = [
        (
            item_id,
            item_upgrade,
            point["date"],
            point.get("step"),
            point.get("avgPrice"),
            point.get("maxPrice"),
            point.get("minPrice"),
            point["endPrice"],
            point.get("sumEnhanceCnt") or 0,
            fetched_at,
        )
        for point in points
    ]
    conn.executemany(
        """
        INSERT INTO sf_price_history_hourly
            (item_id, item_upgrade, price_at, step, avg_price, max_price,
             min_price, end_price, sum_enhance_count, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id, item_upgrade, price_at) DO UPDATE SET
            step=excluded.step,
            avg_price=excluded.avg_price,
            max_price=excluded.max_price,
            min_price=excluded.min_price,
            end_price=excluded.end_price,
            sum_enhance_count=excluded.sum_enhance_count,
            fetched_at=excluded.fetched_at
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def record_progress(
    conn: sqlite3.Connection,
    item_id: int,
    item_upgrade: int,
    *,
    status: str,
    row_count: int,
    oldest_at: str | None,
    newest_at: str | None,
    updated_at: str,
    note: str | None = None,
) -> None:
    """UPSERT the resumability marker for one (item_id, item_upgrade) combo."""
    if status not in ("done", "error"):
        raise ValueError(f"status must be 'done' or 'error', got {status!r}")
    conn.execute(
        """
        INSERT INTO sf_history_backfill_progress
            (item_id, item_upgrade, status, row_count, oldest_at, newest_at, updated_at, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id, item_upgrade) DO UPDATE SET
            status=excluded.status,
            row_count=excluded.row_count,
            oldest_at=excluded.oldest_at,
            newest_at=excluded.newest_at,
            updated_at=excluded.updated_at,
            note=excluded.note
        """,
        (item_id, item_upgrade, status, row_count, oldest_at, newest_at, updated_at, note),
    )
    conn.commit()


def load_done_combinations(conn: sqlite3.Connection) -> set[tuple[int, int]]:
    """Return the (item_id, item_upgrade) pairs already marked status='done'."""
    cur = conn.execute(
        "SELECT item_id, item_upgrade FROM sf_history_backfill_progress WHERE status = 'done'"
    )
    return {(row[0], row[1]) for row in cur.fetchall()}


def count_progress_by_status(conn: sqlite3.Connection) -> dict[str, int]:
    cur = conn.execute(
        "SELECT status, COUNT(*) FROM sf_history_backfill_progress GROUP BY status"
    )
    return {row[0]: row[1] for row in cur.fetchall()}


def count_hourly_rows(conn: sqlite3.Connection) -> int:
    cur = conn.execute("SELECT COUNT(*) FROM sf_price_history_hourly")
    return int(cur.fetchone()[0])


def count_duplicate_hourly_rows(conn: sqlite3.Connection) -> int:
    """COUNT(*) - COUNT(DISTINCT key) -- must be 0 (accept criterion (e))."""
    cur = conn.execute(
        "SELECT COUNT(*) - COUNT(DISTINCT item_id || '/' || item_upgrade || '/' || price_at) "
        "FROM sf_price_history_hourly"
    )
    return int(cur.fetchone()[0])


def list_error_combinations(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    cur = conn.execute(
        "SELECT item_id, item_upgrade, note, updated_at FROM sf_history_backfill_progress "
        "WHERE status = 'error' ORDER BY item_id, item_upgrade"
    )
    return [
        {"itemId": row[0], "itemUpgrade": row[1], "note": row[2], "updatedAt": row[3]}
        for row in cur.fetchall()
    ]


# --- SH-3: sf_price_history_4h access (aggregate.py / app.py) ---------------


def distinct_hourly_combinations(conn: sqlite3.Connection) -> list[tuple[int, int]]:
    """Every (item_id, item_upgrade) that has at least one hourly row.

    Combinations backfilled with 0 rows (design §7.1: items that cap below
    ☆22) never appear here -- there is nothing to derive a 4h bucket from.
    """
    cur = conn.execute(
        "SELECT DISTINCT item_id, item_upgrade FROM sf_price_history_hourly "
        "ORDER BY item_id, item_upgrade"
    )
    return [(row[0], row[1]) for row in cur.fetchall()]


def hourly_series(
    conn: sqlite3.Connection, item_id: int, item_upgrade: int, *, since: str | None = None
) -> list[tuple[str, float]]:
    """(price_at, end_price) pairs for one series, ordered by price_at.

    ``since`` (inclusive) scopes the query to an incremental re-aggregation
    window (aggregate.update_combo_incremental) -- it must always be a value
    that is itself a 4h bucket boundary, so that no row belonging to a bucket
    starting before it is silently dropped (aggregate.py enforces this).
    """
    if since is None:
        cur = conn.execute(
            "SELECT price_at, end_price FROM sf_price_history_hourly "
            "WHERE item_id = ? AND item_upgrade = ? ORDER BY price_at",
            (item_id, item_upgrade),
        )
    else:
        cur = conn.execute(
            "SELECT price_at, end_price FROM sf_price_history_hourly "
            "WHERE item_id = ? AND item_upgrade = ? AND price_at >= ? ORDER BY price_at",
            (item_id, item_upgrade, since),
        )
    return [(row[0], row[1]) for row in cur.fetchall()]


def replace_4h_rows(
    conn: sqlite3.Connection,
    item_id: int,
    item_upgrade: int,
    rows: Iterable[dict[str, Any]],
    *,
    since: str | None = None,
) -> int:
    """Fully replace (delete then insert) the 4h rows for one combination.

    A full replace (not UPSERT-only) is what makes the determinism guarantee
    (IMPL_PLAN_SH3 §7(a)) hold: re-deriving a range can never leave a stale
    row behind from a previous run's different bucket boundary. ``since``
    (inclusive, a bucket-start value) scopes both the delete and the implicit
    insert range to an incremental re-aggregation; ``None`` replaces the
    combination's entire history.
    """
    rows = list(rows)
    if since is None:
        conn.execute(
            "DELETE FROM sf_price_history_4h WHERE item_id = ? AND item_upgrade = ?",
            (item_id, item_upgrade),
        )
    else:
        conn.execute(
            "DELETE FROM sf_price_history_4h WHERE item_id = ? AND item_upgrade = ? AND price_at >= ?",
            (item_id, item_upgrade, since),
        )
    conn.executemany(
        """
        INSERT INTO sf_price_history_4h
            (item_id, item_upgrade, price_at, end_price, source_hour_at, generated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        [
            (
                item_id,
                item_upgrade,
                row["price_at"],
                row["end_price"],
                row["source_hour_at"],
                row["generated_at"],
            )
            for row in rows
        ],
    )
    conn.commit()
    return len(rows)


def count_4h_rows(conn: sqlite3.Connection) -> int:
    cur = conn.execute("SELECT COUNT(*) FROM sf_price_history_4h")
    return int(cur.fetchone()[0])


def max_4h_price_at_for_combo(
    conn: sqlite3.Connection, item_id: int, item_upgrade: int
) -> str | None:
    cur = conn.execute(
        "SELECT MAX(price_at) FROM sf_price_history_4h WHERE item_id = ? AND item_upgrade = ?",
        (item_id, item_upgrade),
    )
    row = cur.fetchone()
    return row[0] if row else None


def max_upgrade_by_item(conn: sqlite3.Connection) -> dict[int, int]:
    """MAX(item_upgrade) with at least one hourly row, per item_id.

    This is the data-derived basis for ``maxStar`` (design §7.1: "ハードコード
    せず、hourly の実データから導出する"). Combinations backfilled with 0 rows
    (items that cap below ☆22) never appear in ``sf_price_history_hourly``, so
    they are naturally excluded here without any special-casing.
    """
    cur = conn.execute(
        "SELECT item_id, MAX(item_upgrade) FROM sf_price_history_hourly GROUP BY item_id"
    )
    return {row[0]: row[1] for row in cur.fetchall()}


def four_h_rows_for_item(conn: sqlite3.Connection, item_id: int) -> list[tuple[int, str, float]]:
    """(item_upgrade, price_at, end_price) for every 4h row of one item, ordered."""
    cur = conn.execute(
        "SELECT item_upgrade, price_at, end_price FROM sf_price_history_4h "
        "WHERE item_id = ? ORDER BY price_at, item_upgrade",
        (item_id,),
    )
    return [(row[0], row[1], row[2]) for row in cur.fetchall()]


def latest_generated_at_for_item(conn: sqlite3.Connection, item_id: int) -> str | None:
    cur = conn.execute(
        "SELECT MAX(generated_at) FROM sf_price_history_4h WHERE item_id = ?", (item_id,)
    )
    row = cur.fetchone()
    return row[0] if row else None


# --- IMPL_PLAN_SH32: DISCOVERY (bonus period) detection/recording -----------
# Component A (scan_discovery.py) writes sf_discovery_scan_runs / _scan_raw /
# _monitored_groups; Component B (poll_discovery.py) writes
# sf_discovery_price_history; Component C (app.py's /sf-history/discovery/*
# routes) only ever reads. See discovery.py for the parsing/judging rules and
# schema.sql for each table's own header comment.


def record_discovery_scan_run(
    conn: sqlite3.Connection,
    *,
    run_at: str,
    groups_total: int,
    items_total: int,
    items_failed: int,
    monitored_groups: int,
    duration_ms: float,
) -> int:
    cur = conn.execute(
        """
        INSERT INTO sf_discovery_scan_runs
            (run_at, groups_total, items_total, items_failed, monitored_groups, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (run_at, groups_total, items_total, items_failed, monitored_groups, duration_ms),
    )
    conn.commit()
    return int(cur.lastrowid)


def insert_discovery_scan_raw_rows(
    conn: sqlite3.Connection,
    run_id: int,
    item_id: int,
    steps: list[str | None],
    fetched_at: str,
) -> int:
    """One row per band (``len(steps)`` -- always ``discovery.UPGRADE_COUNT``
    in production, but this function does not itself assume 25 -- plan §5
    condition (b) failure mode: never hardcode the band count)."""
    rows = [(run_id, item_id, upgrade, step, fetched_at) for upgrade, step in enumerate(steps)]
    conn.executemany(
        """
        INSERT INTO sf_discovery_scan_raw (run_id, item_id, item_upgrade, step, fetched_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(run_id, item_id, item_upgrade) DO UPDATE SET
            step=excluded.step, fetched_at=excluded.fetched_at
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def upsert_discovery_monitored_group(
    conn: sqlite3.Connection,
    *,
    representative_item_id: int,
    item_name: str | None,
    equip_level_type: str,
    equip_type: str,
    equip_part_type: str,
    alias_item_ids: list[int],
    aliases: list[dict[str, Any]],
    steps_consistent: bool,
    is_active: bool,
    now: str,
) -> None:
    """Upsert one monitored group (plan §2 A-1). ``first_seen_at`` is
    preserved across updates (only set on first insert) -- ``last_scan_at``
    always advances to ``now``.

    Callers only invoke this for a *consistent* scan result (plan §2 A-1 /
    §5(g-3): an inconsistent group is logged and left untouched, never
    upserted here with ``steps_consistent=False`` for a fresh row) -- this
    function itself does not enforce that policy, it just writes what it is
    given.
    """
    conn.execute(
        """
        INSERT INTO sf_discovery_monitored_groups
            (representative_item_id, item_name, equip_level_type, equip_type, equip_part_type,
             alias_item_ids_json, aliases_json, steps_consistent, is_active, first_seen_at, last_scan_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(representative_item_id) DO UPDATE SET
            item_name=excluded.item_name,
            equip_level_type=excluded.equip_level_type,
            equip_type=excluded.equip_type,
            equip_part_type=excluded.equip_part_type,
            alias_item_ids_json=excluded.alias_item_ids_json,
            aliases_json=excluded.aliases_json,
            steps_consistent=excluded.steps_consistent,
            is_active=excluded.is_active,
            last_scan_at=excluded.last_scan_at
        """,
        (
            representative_item_id,
            item_name,
            equip_level_type,
            equip_type,
            equip_part_type,
            json.dumps(alias_item_ids),
            json.dumps(aliases, ensure_ascii=False),
            1 if steps_consistent else 0,
            1 if is_active else 0,
            now,
            now,
        ),
    )
    conn.commit()


def deactivate_discovery_groups_not_in(
    conn: sqlite3.Connection, still_active_representative_ids: set[int], *, now: str
) -> int:
    """plan §2 A-1 / §5(k): a group this scan no longer finds monitored is
    flipped to ``is_active=0`` -- the row (and its aliases/name) is kept
    forever, only ``B``'s poll target list (Component B reads ``is_active=1``
    only) and the main equipment list (§5(g)) stop showing it. Returns the
    number of rows actually flipped (0 -> already inactive is a no-op, not
    counted)."""
    cur = conn.execute("SELECT representative_item_id FROM sf_discovery_monitored_groups WHERE is_active = 1")
    currently_active = {row[0] for row in cur.fetchall()}
    to_deactivate = currently_active - still_active_representative_ids
    if not to_deactivate:
        return 0
    conn.executemany(
        "UPDATE sf_discovery_monitored_groups SET is_active = 0, last_scan_at = ? WHERE representative_item_id = ?",
        [(now, item_id) for item_id in to_deactivate],
    )
    conn.commit()
    return len(to_deactivate)


def _monitored_group_row_to_dict(row: tuple[Any, ...]) -> dict[str, Any]:
    (
        representative_item_id,
        item_name,
        equip_level_type,
        equip_type,
        equip_part_type,
        alias_item_ids_json,
        aliases_json,
        steps_consistent,
        is_active,
        first_seen_at,
        last_scan_at,
    ) = row
    return {
        "itemId": representative_item_id,
        "itemName": item_name,
        "equipLevelType": equip_level_type,
        "equipType": equip_type,
        "equipPartType": equip_part_type,
        "aliasItemIds": json.loads(alias_item_ids_json),
        "aliases": json.loads(aliases_json),
        "stepsConsistent": bool(steps_consistent),
        "isActive": bool(is_active),
        "firstSeenAt": first_seen_at,
        "lastScanAt": last_scan_at,
    }


_MONITORED_GROUP_COLUMNS = (
    "representative_item_id, item_name, equip_level_type, equip_type, equip_part_type, "
    "alias_item_ids_json, aliases_json, steps_consistent, is_active, first_seen_at, last_scan_at"
)


def list_active_discovery_monitored_groups(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    cur = conn.execute(
        f"SELECT {_MONITORED_GROUP_COLUMNS} FROM sf_discovery_monitored_groups "
        "WHERE is_active = 1 ORDER BY representative_item_id"
    )
    return [_monitored_group_row_to_dict(row) for row in cur.fetchall()]


def list_visible_discovery_monitored_groups(conn: sqlite3.Connection, *, since_iso: str) -> list[dict[str, Any]]:
    """IMPL_PLAN_SH33 follow-up (post-review, ユーザー実機レビュー): every
    ACTIVE group, PLUS every group deactivated on or after ``since_iso`` --
    "全帯が形成済みになった装備が30日間は一覧に残り、表(帯ごとの遷移時刻)が
    引き続き見られる" (a fully-settled item must not vanish from
    ``discovery_equipment`` the instant `scripts/scan_discovery.py`
    deactivates it, or its own transition-time table in
    ``discovery_prices`` becomes unreachable).

    ``last_scan_at`` doubles as "when this row was last touched by a scan
    run" -- for an ACTIVE group that advances every daily scan (irrelevant
    here, it is already included via ``is_active = 1``); for an INACTIVE
    group it is frozen at the exact run that flipped ``is_active`` to 0
    (``deactivate_discovery_groups_not_in``/``deactivate_discovery_group``,
    the only two writers that ever touch an inactive row's ``last_scan_at``
    again) -- i.e. it IS the deactivation timestamp for an inactive row,
    which is exactly the recency this function needs to filter on.

    Deliberately a NEW function rather than widening
    ``list_active_discovery_monitored_groups`` itself: that function is also
    `scripts/poll_discovery.py`'s (Component B) own poll-target list, which
    must keep polling ONLY truly-active groups (a fully-settled item has
    nothing left to observe -- polling it would waste budget and contradict
    the very reason it was deactivated). Only `app.py`'s
    ``discovery_equipment`` route calls this one.
    """
    cur = conn.execute(
        f"SELECT {_MONITORED_GROUP_COLUMNS} FROM sf_discovery_monitored_groups "
        "WHERE is_active = 1 OR last_scan_at >= ? ORDER BY representative_item_id",
        (since_iso,),
    )
    return [_monitored_group_row_to_dict(row) for row in cur.fetchall()]


def list_all_discovery_monitored_groups(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Active AND inactive (plan §5(k): "記録は永久に残す") -- used by the
    "recent" transitions lookup, which must still resolve a name for a group
    that has since gone fully quiet."""
    cur = conn.execute(f"SELECT {_MONITORED_GROUP_COLUMNS} FROM sf_discovery_monitored_groups ORDER BY representative_item_id")
    return [_monitored_group_row_to_dict(row) for row in cur.fetchall()]


def get_discovery_monitored_group(conn: sqlite3.Connection, representative_item_id: int) -> dict[str, Any] | None:
    cur = conn.execute(
        f"SELECT {_MONITORED_GROUP_COLUMNS} FROM sf_discovery_monitored_groups WHERE representative_item_id = ?",
        (representative_item_id,),
    )
    row = cur.fetchone()
    return _monitored_group_row_to_dict(row) if row else None


def get_discovery_monitored_group_by_group_key(
    conn: sqlite3.Connection, equip_level_type: str, equip_type: str, equip_part_type: str
) -> dict[str, Any] | None:
    """★2026-08-15 fix: the group's real identity lookup -- (equip_level_type,
    equip_type, equip_part_type), NOT `representative_item_id`.
    `scripts/scan_discovery.py` calls this BEFORE ever calling
    `pick_representative_item` again, so an already-known group's
    representative is reused (fixed) rather than re-picked every scan purely
    because `weekCount` moved. Returns the row regardless of `is_active` --
    a group's identity persists through an inactive period too (plan §5(k)).
    Assumes at most one row per group identity, which the partial unique
    index (`idx_discovery_monitored_groups_active_group_key`, schema.sql)
    only actually guarantees for *active* rows -- a caller relying on this
    returning the single true answer for an *inactive* group identity that
    somehow has more than one historical row (should not happen if scan_
    discovery.py's ordering discipline is followed) gets whichever SQLite
    returns first; this has never been observed and is not defended against
    further here.
    """
    cur = conn.execute(
        f"SELECT {_MONITORED_GROUP_COLUMNS} FROM sf_discovery_monitored_groups "
        "WHERE equip_level_type = ? AND equip_type = ? AND equip_part_type = ?",
        (equip_level_type, equip_type, equip_part_type),
    )
    row = cur.fetchone()
    return _monitored_group_row_to_dict(row) if row else None


def deactivate_discovery_group(conn: sqlite3.Connection, representative_item_id: int, *, now: str) -> None:
    """★2026-08-15 fix: explicitly deactivates ONE row by its
    `representative_item_id` -- used only by `scripts/scan_discovery.py`'s
    rare re-selection path (the previously-fixed representative dropped out
    of the group's own member list). Must run BEFORE the new representative's
    row is inserted: it clears the old row's slot in the partial unique
    index (`idx_discovery_monitored_groups_active_group_key`, WHERE
    is_active = 1) so the new row's insert never collides with it. A no-op
    (still `UPDATE`s `last_scan_at`) if the row was already inactive."""
    conn.execute(
        "UPDATE sf_discovery_monitored_groups SET is_active = 0, last_scan_at = ? WHERE representative_item_id = ?",
        (now, representative_item_id),
    )
    conn.commit()


def upsert_discovery_price_points(
    conn: sqlite3.Connection,
    item_id: int,
    item_upgrade: int,
    points: list[dict[str, Any]],
    fetched_at: str,
) -> int:
    """UPSERT Component B's per-band points (plan §2 B / §5(d)/(e)): each
    ``point`` is ``{"priceAt", "endAt", "price", "step"}``
    (``discovery.parse_dynamicprice_points``'s own shape). Same
    (item_id, item_upgrade, price_at) upsert key discipline as
    ``upsert_hourly_rows`` above."""
    rows = [
        (item_id, item_upgrade, point["priceAt"], point.get("endAt"), point["price"], point["step"], fetched_at)
        for point in points
        if point.get("priceAt")
    ]
    if not rows:
        return 0
    conn.executemany(
        """
        INSERT INTO sf_discovery_price_history
            (item_id, item_upgrade, price_at, end_at, price, step, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id, item_upgrade, price_at) DO UPDATE SET
            end_at=excluded.end_at,
            price=excluded.price,
            step=excluded.step,
            fetched_at=excluded.fetched_at
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def latest_discovery_bands_for_item(
    conn: sqlite3.Connection, item_id: int
) -> tuple[dict[int, dict[str, Any]], str | None]:
    """The most recent (by ``price_at``) row per band for ``item_id``, plus
    the freshest ``fetched_at`` across all of them (plan §5(j): "観測時刻を
    必ず表示する"). Returns ``({}, None)`` if Component B has never polled
    this item.
    """
    cur = conn.execute(
        "SELECT item_upgrade, price_at, end_at, price, step, fetched_at "
        "FROM sf_discovery_price_history WHERE item_id = ? ORDER BY item_upgrade, price_at",
        (item_id,),
    )
    bands: dict[int, dict[str, Any]] = {}
    observed_at: str | None = None
    for item_upgrade, price_at, end_at, price, step, fetched_at in cur.fetchall():
        # ORDER BY price_at ASC per band -- the last row seen per item_upgrade
        # (dict overwrite) is always the most recent one.
        bands[item_upgrade] = {"priceAt": price_at, "endAt": end_at, "price": price, "step": step}
        if observed_at is None or fetched_at > observed_at:
            observed_at = fetched_at
    return bands, observed_at


def find_recent_discovery_transitions(
    conn: sqlite3.Connection, *, since_iso: str
) -> list[dict[str, Any]]:
    """plan §5(f)/(k): every (item_id, item_upgrade) band whose recorded
    history shows a DISCOVERY -> CHANGE flip (``discovery.find_transition``)
    ending on or after ``since_iso``. Iterates every distinct band this
    service has EVER polled (active or since-deactivated groups alike --
    §5(k): "記録は永久に残す" is not conditioned on the group's current
    ``is_active``); the caller (app.py) narrows by day-count into
    ``since_iso`` and attaches display names.
    """
    import discovery  # local import: keeps db.py's top-level imports DB-only

    cur = conn.execute(
        "SELECT DISTINCT item_id, item_upgrade FROM sf_discovery_price_history ORDER BY item_id, item_upgrade"
    )
    combos = cur.fetchall()

    results: list[dict[str, Any]] = []
    for item_id, item_upgrade in combos:
        rows_cur = conn.execute(
            "SELECT price_at, step FROM sf_discovery_price_history WHERE item_id = ? AND item_upgrade = ?",
            (item_id, item_upgrade),
        )
        rows = [(row[0], row[1]) for row in rows_cur.fetchall()]
        transition = discovery.find_transition(rows)
        if transition is None:
            continue
        window_start, window_end = transition
        if window_end < since_iso:
            continue
        results.append(
            {
                "itemId": item_id,
                "itemUpgrade": item_upgrade,
                "windowStart": window_start,
                "windowEnd": window_end,
            }
        )
    return results


# --- IMPL_PLAN_SH34 §2-1: sf_discovery_cube_price_history access ------------
# Same writer discipline as sf_discovery_price_history above (Component B /
# poll_discovery.py only) -- see that table's schema.sql header comment.


def upsert_discovery_cube_price_points(
    conn: sqlite3.Connection,
    item_id: int,
    cube_item_id: int,
    points: list[dict[str, Any]],
    fetched_at: str,
) -> int:
    """UPSERT Component B's per-cube points -- the cube counterpart of
    `upsert_discovery_price_points` above, same
    `{"priceAt", "endAt", "price", "step"}` point shape
    (`discovery.parse_dynamicprice_cube_points`), same
    (item_id, cube_item_id, price_at) upsert-key discipline."""
    rows = [
        (item_id, cube_item_id, point["priceAt"], point.get("endAt"), point["price"], point["step"], fetched_at)
        for point in points
        if point.get("priceAt")
    ]
    if not rows:
        return 0
    conn.executemany(
        """
        INSERT INTO sf_discovery_cube_price_history
            (item_id, cube_item_id, price_at, end_at, price, step, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id, cube_item_id, price_at) DO UPDATE SET
            end_at=excluded.end_at,
            price=excluded.price,
            step=excluded.step,
            fetched_at=excluded.fetched_at
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def latest_discovery_cubes_for_item(
    conn: sqlite3.Connection, item_id: int
) -> tuple[dict[int, dict[str, Any]], str | None]:
    """The most recent (by `price_at`) row per `cube_item_id` for `item_id`,
    plus the freshest `fetched_at` across all of them -- the cube
    counterpart of `latest_discovery_bands_for_item`. The query is `ORDER BY
    cube_item_id`, so the returned dict's key order is already the
    deterministic "code order" `app.py`'s response uses (plan §3: "並び順は
    決定的にする...コード順で構わない") -- callers do not need to re-sort.
    Returns `({}, None)` if Component B has never polled this item's cubes
    (also true for an item with none of its cube data recorded yet, even if
    its bands have been -- plan §4: "キューブが1件も無い装備では、表ごと
    出さない" is exactly this empty-dict case, left to the caller to act on).
    """
    cur = conn.execute(
        "SELECT cube_item_id, price_at, end_at, price, step, fetched_at "
        "FROM sf_discovery_cube_price_history WHERE item_id = ? ORDER BY cube_item_id, price_at",
        (item_id,),
    )
    cubes: dict[int, dict[str, Any]] = {}
    observed_at: str | None = None
    for cube_item_id, price_at, end_at, price, step, fetched_at in cur.fetchall():
        # ORDER BY price_at ASC per cube -- the last row seen per cube_item_id
        # (dict overwrite) is always the most recent one.
        cubes[cube_item_id] = {"priceAt": price_at, "endAt": end_at, "price": price, "step": step}
        if observed_at is None or fetched_at > observed_at:
            observed_at = fetched_at
    return cubes, observed_at


def find_discovery_cube_transitions_for_item(conn: sqlite3.Connection, item_id: int) -> dict[int, tuple[str, str]]:
    """The cube counterpart of `find_discovery_transitions_for_item`: `cube_
    item_id -> (windowStart, windowEnd)` for every cube of ONE item that has
    ever recorded a DISCOVERY -> CHANGE flip (`discovery.find_transition`,
    plan §3: "遷移時刻の導出は SF と同じ仕組み...別ロジックを作らない"). A
    cube absent from the returned dict never showed an observed flip in the
    recorded history (still DISCOVERY, or already CHANGE in the first row
    ever recorded -- indistinguishable, "推測して埋めない" as with bands)."""
    import discovery  # local import: keeps db.py's top-level imports DB-only

    cur = conn.execute(
        "SELECT cube_item_id, price_at, step FROM sf_discovery_cube_price_history "
        "WHERE item_id = ? ORDER BY cube_item_id, price_at",
        (item_id,),
    )
    rows_by_cube: dict[int, list[tuple[str, str]]] = {}
    for cube_item_id, price_at, step in cur.fetchall():
        rows_by_cube.setdefault(cube_item_id, []).append((price_at, step))

    transitions: dict[int, tuple[str, str]] = {}
    for cube_item_id, rows in rows_by_cube.items():
        transition = discovery.find_transition(rows)
        if transition is not None:
            transitions[cube_item_id] = transition
    return transitions


def find_discovery_transitions_for_item(conn: sqlite3.Connection, item_id: int) -> dict[int, tuple[str, str]]:
    """IMPL_PLAN_SH33 follow-up (post-review): the per-item, all-bands
    counterpart of ``find_recent_discovery_transitions`` above -- ``item_
    upgrade -> (windowStart, windowEnd)`` for every band of ONE item that
    has ever recorded a DISCOVERY -> CHANGE flip (``discovery.
    find_transition``), NOT windowed by recency (unlike the function above,
    which exists for the cross-item "recent activity" feed and IS windowed
    by ``since_iso`` -- this one backs `discovery_prices`' own per-band
    "when did this band settle" column, which has no reason to hide an
    old transition just because it happened more than N days ago).

    A band absent from the returned dict never showed an observed flip in
    the recorded history -- either still DISCOVERY, or already CHANGE in the
    very first row ever recorded for it (i.e. it settled before monitoring
    started, so the true instant is unknowable) -- both cases are
    deliberately indistinguishable here (plan: "推測して埋めない", never
    invent a value for either).

    One query for the whole item (not one query per band, unlike the
    N-combo loop above, which has to scan every item this service has ever
    touched and so cannot narrow by item_id up front) -- grouping into
    per-band row lists happens in Python before handing each to
    ``discovery.find_transition``.
    """
    import discovery  # local import: keeps db.py's top-level imports DB-only

    cur = conn.execute(
        "SELECT item_upgrade, price_at, step FROM sf_discovery_price_history "
        "WHERE item_id = ? ORDER BY item_upgrade, price_at",
        (item_id,),
    )
    rows_by_upgrade: dict[int, list[tuple[str, str]]] = {}
    for item_upgrade, price_at, step in cur.fetchall():
        rows_by_upgrade.setdefault(item_upgrade, []).append((price_at, step))

    transitions: dict[int, tuple[str, str]] = {}
    for item_upgrade, rows in rows_by_upgrade.items():
        transition = discovery.find_transition(rows)
        if transition is not None:
            transitions[item_upgrade] = transition
    return transitions


# --- IMPL_PLAN_SH36: maxStar union (hourly history + DISCOVERY presence) ----


def discovery_max_upgrade_by_item(conn: sqlite3.Connection) -> dict[int, int]:
    """MAX(item_upgrade) with at least one recorded band, per representative
    item_id, restricted to ``discovery.JUDGE_UPGRADE_COUNT`` (0..21 -- the
    same range the main SF History chart/latest endpoints ever display;
    IMPL_PLAN_SH36 §0/§3). ☆23-25 (itemUpgrade 22..24) are the
    DISCOVERY-page-only display extension and are never counted toward this
    system's own maxStar.

    A second, additive source for ``maxStar`` alongside ``max_upgrade_by_item``
    (hourly-history-derived) above -- for an item whose price history has
    GAPS because some of its real bands are still in a DISCOVERY
    (price-forming) period and have therefore never recorded a
    ``sf_price_history_hourly`` row at all (that table only ever gains a row
    once a band has a settled/CHANGE price -- IMPL_PLAN_SH36 §0 H5). Every
    row this reads comes from ``sf_discovery_price_history``, already written
    by the existing 5-minute poller (``scripts/poll_discovery.py``) -- this
    adds no new upstream call (plan §6(l)). Returns ``{}`` if the table does
    not exist yet (a dev DB that predates IMPL_PLAN_SH32), same "graceful,
    never guessed" degrade as ``gen_item_list.py``'s own missing-DB handling.
    """
    import discovery  # local import: keeps db.py's top-level imports DB-only

    try:
        cur = conn.execute(
            "SELECT item_id, MAX(item_upgrade) FROM sf_discovery_price_history "
            "WHERE item_upgrade < ? GROUP BY item_id",
            (discovery.JUDGE_UPGRADE_COUNT,),
        )
    except sqlite3.OperationalError:
        return {}
    return {row[0]: row[1] for row in cur.fetchall()}


# --- IMPL_PLAN_SH39: sf_cube_price_history_hourly/_4h + backfill progress ---
# The CUBE (prospective) counterpart of the SH-2/SH-3 hourly/4h/progress
# functions above, keyed by (item_id, cube_sub_type) instead of
# (item_id, item_upgrade). NEW functions only -- none of the SF functions
# above are modified (plan §7: "既存の挙動は1ビットも変えない").


def upsert_cube_hourly_rows(
    conn: sqlite3.Connection,
    item_id: int,
    cube_sub_type: str,
    points: Iterable[dict[str, Any]],
    fetched_at: str,
) -> int:
    """UPSERT one (item_id, cube_sub_type) combo's CUBE history points.

    Same per-call-commit / unconverted-``end_price`` discipline as
    ``upsert_hourly_rows`` above (see that function's docstring).
    """
    rows = [
        (
            item_id,
            cube_sub_type,
            point["date"],
            point.get("step"),
            point.get("avgPrice"),
            point.get("maxPrice"),
            point.get("minPrice"),
            point["endPrice"],
            point.get("sumEnhanceCnt") or 0,
            fetched_at,
        )
        for point in points
    ]
    conn.executemany(
        """
        INSERT INTO sf_cube_price_history_hourly
            (item_id, cube_sub_type, price_at, step, avg_price, max_price,
             min_price, end_price, sum_enhance_count, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id, cube_sub_type, price_at) DO UPDATE SET
            step=excluded.step,
            avg_price=excluded.avg_price,
            max_price=excluded.max_price,
            min_price=excluded.min_price,
            end_price=excluded.end_price,
            sum_enhance_count=excluded.sum_enhance_count,
            fetched_at=excluded.fetched_at
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def record_cube_progress(
    conn: sqlite3.Connection,
    item_id: int,
    cube_sub_type: str,
    *,
    status: str,
    row_count: int,
    oldest_at: str | None,
    newest_at: str | None,
    updated_at: str,
    note: str | None = None,
) -> None:
    """UPSERT the resumability marker for one (item_id, cube_sub_type) combo."""
    if status not in ("done", "error"):
        raise ValueError(f"status must be 'done' or 'error', got {status!r}")
    conn.execute(
        """
        INSERT INTO sf_cube_history_backfill_progress
            (item_id, cube_sub_type, status, row_count, oldest_at, newest_at, updated_at, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id, cube_sub_type) DO UPDATE SET
            status=excluded.status,
            row_count=excluded.row_count,
            oldest_at=excluded.oldest_at,
            newest_at=excluded.newest_at,
            updated_at=excluded.updated_at,
            note=excluded.note
        """,
        (item_id, cube_sub_type, status, row_count, oldest_at, newest_at, updated_at, note),
    )
    conn.commit()


def load_done_cube_combinations(conn: sqlite3.Connection) -> set[tuple[int, str]]:
    """Return the (item_id, cube_sub_type) pairs already marked status='done'."""
    cur = conn.execute(
        "SELECT item_id, cube_sub_type FROM sf_cube_history_backfill_progress WHERE status = 'done'"
    )
    return {(row[0], row[1]) for row in cur.fetchall()}


def count_progress_by_status_cube(conn: sqlite3.Connection) -> dict[str, int]:
    cur = conn.execute(
        "SELECT status, COUNT(*) FROM sf_cube_history_backfill_progress GROUP BY status"
    )
    return {row[0]: row[1] for row in cur.fetchall()}


def count_cube_hourly_rows(conn: sqlite3.Connection) -> int:
    cur = conn.execute("SELECT COUNT(*) FROM sf_cube_price_history_hourly")
    return int(cur.fetchone()[0])


def count_duplicate_cube_hourly_rows(conn: sqlite3.Connection) -> int:
    """COUNT(*) - COUNT(DISTINCT key) -- must be 0 (accept criterion (e))."""
    cur = conn.execute(
        "SELECT COUNT(*) - COUNT(DISTINCT item_id || '/' || cube_sub_type || '/' || price_at) "
        "FROM sf_cube_price_history_hourly"
    )
    return int(cur.fetchone()[0])


def list_error_cube_combinations(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    cur = conn.execute(
        "SELECT item_id, cube_sub_type, note, updated_at FROM sf_cube_history_backfill_progress "
        "WHERE status = 'error' ORDER BY item_id, cube_sub_type"
    )
    return [
        {"itemId": row[0], "cubeSubType": row[1], "note": row[2], "updatedAt": row[3]}
        for row in cur.fetchall()
    ]


def max_star_by_item(conn: sqlite3.Connection) -> dict[int, int]:
    """``maxStar`` per item_id -- the union of ``max_upgrade_by_item``
    (hourly-history-derived) and ``discovery_max_upgrade_by_item`` (DISCOVERY-
    presence-derived) above, whichever attests the HIGHER band for a given
    item (design §7.1: never hardcoded, always derived from actually
    recorded data; IMPL_PLAN_SH36: an item with a still-forming HIGH band
    must not have its maxStar under-reported just because that band has no
    hourly row yet).

    For every item that has never had a ``sf_discovery_price_history`` row
    (every one of the pre-SH-36 31 items -- a representative only gets rows
    there once it becomes DISCOVERY-monitored, IMPL_PLAN_SH32), this is
    byte-identical to the old ``max_upgrade_by_item(conn).get(id) + 1``
    computation -- IMPL_PLAN_SH36 §6(g)/(b): existing equipment's maxStar
    does not move by even one star.
    """
    hourly = max_upgrade_by_item(conn)
    discovery_derived = discovery_max_upgrade_by_item(conn)
    result: dict[int, int] = {}
    for item_id in set(hourly) | set(discovery_derived):
        max_upgrade = max(hourly.get(item_id, -1), discovery_derived.get(item_id, -1))
        result[item_id] = max_upgrade + 1
    return result
