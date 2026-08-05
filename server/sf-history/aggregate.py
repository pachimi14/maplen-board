"""SH-3 §3: deterministic hourly -> 4h derivation (design §9).

Bucket boundaries are UTC 00/04/08/12/16/20. The representative value for a
bucket is the ``end_price`` of the hourly row with the LATEST ``price_at``
that exists inside it (design §9: "区間内で最後に存在する時刻の end_price").
The bucket's label is its START time (design §9: "ラベルは区間開始時刻").
A bucket that has not fully elapsed yet as of ``now`` is never emitted
(design §9: "進行中の区間は確定しない") -- it simply does not exist until a
later run, once it has elapsed, computes and inserts it; it is never written
early with a "best value so far" and then revised in place.

Each (item_id, item_upgrade) series is aggregated independently (design
§2.2: "星ごとに履歴の深さが違う" -- do not wait for "all stars ready" before
emitting a bucket for the stars that do have data).

Determinism (IMPL_PLAN_SH3 §7(a)): ``compute_buckets`` is a pure function of
its inputs (``rows``, ``now``) -- the same hourly rows and the same ``now``
always produce the same bucket set. Wall-clock time only enters at the
CLI/script boundary (``scripts/rebuild_4h.py`` / ``scripts/update.py``
default ``now`` to the real clock when the caller does not pin it).
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

import db

BUCKET_HOURS = 4
UPGRADE_COUNT = 22  # itemUpgrade 0..21 (SH-2 never fetches 22; plan §8 condition 6)


def parse_iso_utc(value: str) -> datetime:
    """Parse an ISO8601 UTC timestamp (the hourly/4h tables' own "...Z" spelling)."""
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def format_iso_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def bucket_start(price_at: str) -> str:
    """The UTC 4h-bucket start (00/04/08/12/16/20) that ``price_at`` falls into."""
    dt = parse_iso_utc(price_at)
    floored_hour = (dt.hour // BUCKET_HOURS) * BUCKET_HOURS
    start = dt.replace(hour=floored_hour, minute=0, second=0, microsecond=0)
    return format_iso_utc(start)


def bucket_end(bucket_start_iso: str) -> str:
    return format_iso_utc(parse_iso_utc(bucket_start_iso) + timedelta(hours=BUCKET_HOURS))


def compute_buckets(rows: Iterable[tuple[str, float]], *, now: datetime) -> list[dict[str, Any]]:
    """Derive completed 4h buckets for ONE (item_id, item_upgrade) series.

    ``rows``: iterable of (price_at, end_price) pairs, any order, all
    belonging to a single series.

    Returns a list of ``{"price_at": <bucket start>, "end_price": ...,
    "source_hour_at": <the hourly price_at that was chosen>}``, sorted by
    ``price_at``, containing only buckets whose window has fully elapsed as
    of ``now``.

    Relies on ``price_at`` strings sorting lexicographically the same as
    chronologically, which holds because every ``price_at`` in this system is
    the fixed-width ISO8601 UTC "...Z" form (schema.sql).
    """
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)

    latest_in_bucket: dict[str, tuple[str, float]] = {}
    for price_at, end_price in rows:
        start = bucket_start(price_at)
        current = latest_in_bucket.get(start)
        if current is None or price_at > current[0]:
            latest_in_bucket[start] = (price_at, end_price)

    result: list[dict[str, Any]] = []
    for start, (source_hour_at, end_price) in latest_in_bucket.items():
        if parse_iso_utc(bucket_end(start)) > now:
            continue  # in-progress bucket -- design §9 "進行中の区間は確定しない"
        result.append({"price_at": start, "end_price": end_price, "source_hour_at": source_hour_at})

    result.sort(key=lambda row: row["price_at"])
    return result


def rebuild_combo(
    conn,
    item_id: int,
    item_upgrade: int,
    *,
    now: datetime,
    generated_at: str,
    since: str | None = None,
) -> int:
    """Recompute and fully replace the 4h rows for one (item_id, item_upgrade).

    ``since`` (a bucket-start value, inclusive) scopes both the hourly read
    and the 4h replace to an incremental window; ``None`` means "this
    combination's entire history" (``rebuild_all``'s full-rebuild path).
    """
    hourly_rows = db.hourly_series(conn, item_id, item_upgrade, since=since)
    buckets = compute_buckets(hourly_rows, now=now)
    for bucket in buckets:
        bucket["generated_at"] = generated_at
    return db.replace_4h_rows(conn, item_id, item_upgrade, buckets, since=since)


def rebuild_all(conn, *, now: datetime | None = None, generated_at: str | None = None) -> dict[str, Any]:
    """Full rebuild: every (item_id, item_upgrade) with hourly data, from scratch.

    This is what ``scripts/rebuild_4h.py`` calls, and what the determinism
    check (IMPL_PLAN_SH3 §7(a)) compares two runs of.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    if generated_at is None:
        generated_at = format_iso_utc(now)

    combos = db.distinct_hourly_combinations(conn)
    rows_written = 0
    for item_id, item_upgrade in combos:
        rows_written += rebuild_combo(
            conn, item_id, item_upgrade, now=now, generated_at=generated_at, since=None
        )

    return {
        "combos": len(combos),
        "rowsWritten": rows_written,
        "generatedAt": generated_at,
        "now": format_iso_utc(now),
    }


def update_combo_incremental(
    conn,
    item_id: int,
    item_upgrade: int,
    *,
    now: datetime,
    generated_at: str,
) -> int:
    """Re-derive only the 4h buckets that a differential hourly re-fetch could
    have changed (IMPL_PLAN_SH3 §6): the most recently persisted bucket (its
    source hourly rows may have just been revised by the differential job's
    UPSERT -- design §5.2, "後から修正された値に耐える") plus any buckets that
    have newly completed since.

    Because this calls the exact same ``rebuild_combo`` / ``compute_buckets``
    that a full rebuild uses, scoped by ``since``, the result for the
    ``since``-and-later range is byte-identical to what ``rebuild_all`` would
    produce at the same ``now`` -- the equivalence required by plan §7(a).
    """
    last_bucket_start = db.max_4h_price_at_for_combo(conn, item_id, item_upgrade)
    since = last_bucket_start  # None => no existing 4h rows yet: do a full rebuild for this combo
    return rebuild_combo(conn, item_id, item_upgrade, now=now, generated_at=generated_at, since=since)


def content_hash(conn) -> str:
    """SHA-256 over every 4h row's (item_id, item_upgrade, price_at, end_price,
    source_hour_at), ordered -- the determinism check (plan §7(a)).

    Deliberately excludes ``generated_at``: that column records *when* a row
    was (re)computed, not the derived value itself, so two runs made seconds
    apart (in real, non-pinned time) must hash equal even though their
    ``generated_at`` values differ.
    """
    cur = conn.execute(
        "SELECT item_id, item_upgrade, price_at, end_price, source_hour_at "
        "FROM sf_price_history_4h ORDER BY item_id, item_upgrade, price_at"
    )
    digest = hashlib.sha256()
    for row in cur.fetchall():
        digest.update("|".join(repr(value) for value in row).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()
