"""IMPL_PLAN_SH39 §5: CUBE (prospective) counterpart of ``aggregate.py``'s
hourly -> 4h derivation, for ``sf_cube_price_history_hourly`` /
``sf_cube_price_history_4h``.

Reuses ``aggregate.compute_buckets`` UNCHANGED (plan §5/§7: "aggregate.
compute_buckets を再利用する...同関数を改変しない") -- that function is
already a pure function of ``(price_at, end_price)`` pairs and does not
care which table they came from.

Everything else here (the DB read/write plumbing) is a NEW module rather
than a widening of ``aggregate.py``'s own ``rebuild_combo`` / ``rebuild_all``
/ ``update_combo_incremental`` / ``content_hash``, because those are wired
directly to ``sf_price_history_hourly`` / ``sf_price_history_4h`` through
``db.hourly_series`` / ``db.replace_4h_rows`` / ``db.max_4h_price_at_for_
combo`` (keyed by (item_id, item_upgrade)) -- adapting them in place for the
CUBE series key (item_id, cube_sub_type) would mean editing ``aggregate.py``,
which the plan forbids (§7 "触らないもの": "aggregate.py(再利用のみ・改変
禁止)").
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

import aggregate
import db


def rebuild_combo(
    conn,
    item_id: int,
    cube_sub_type: str,
    *,
    now: datetime,
    generated_at: str,
    since: str | None = None,
) -> int:
    """Recompute and fully replace the 4h CUBE rows for one (item_id, cube_sub_type).

    Same ``since``-scoped incremental / full-rebuild contract as ``aggregate.
    rebuild_combo`` (see that function's docstring).
    """
    hourly_rows = db.cube_hourly_series(conn, item_id, cube_sub_type, since=since)
    buckets = aggregate.compute_buckets(hourly_rows, now=now)
    for bucket in buckets:
        bucket["generated_at"] = generated_at
    return db.replace_cube_4h_rows(conn, item_id, cube_sub_type, buckets, since=since)


def rebuild_all(conn, *, now: datetime | None = None, generated_at: str | None = None) -> dict[str, Any]:
    """Full rebuild: every (item_id, cube_sub_type) with hourly CUBE data, from scratch."""
    if now is None:
        now = datetime.now(timezone.utc)
    if generated_at is None:
        generated_at = aggregate.format_iso_utc(now)

    combos = db.distinct_cube_hourly_combinations(conn)
    rows_written = 0
    for item_id, cube_sub_type in combos:
        rows_written += rebuild_combo(
            conn, item_id, cube_sub_type, now=now, generated_at=generated_at, since=None
        )

    return {
        "combos": len(combos),
        "rowsWritten": rows_written,
        "generatedAt": generated_at,
        "now": aggregate.format_iso_utc(now),
    }


def update_combo_incremental(
    conn,
    item_id: int,
    cube_sub_type: str,
    *,
    now: datetime,
    generated_at: str,
) -> int:
    """Re-derive only the 4h CUBE buckets a differential hourly re-fetch could
    have changed -- the CUBE counterpart of ``aggregate.update_combo_
    incremental`` (see that function's docstring for the equivalence-to-
    full-rebuild argument, which holds here for the identical reason: this
    calls the same ``rebuild_combo``/``compute_buckets`` scoped by ``since``).
    """
    last_bucket_start = db.max_cube_4h_price_at_for_combo(conn, item_id, cube_sub_type)
    since = last_bucket_start  # None => no existing 4h rows yet: full rebuild for this combo
    return rebuild_combo(conn, item_id, cube_sub_type, now=now, generated_at=generated_at, since=since)


def content_hash(conn) -> str:
    """SHA-256 over every 4h CUBE row's (item_id, cube_sub_type, price_at,
    end_price, source_hour_at), ordered -- the CUBE determinism check
    (mirrors ``aggregate.content_hash``; same ``generated_at`` exclusion
    rationale).
    """
    cur = conn.execute(
        "SELECT item_id, cube_sub_type, price_at, end_price, source_hour_at "
        "FROM sf_cube_price_history_4h ORDER BY item_id, cube_sub_type, price_at"
    )
    digest = hashlib.sha256()
    for row in cur.fetchall():
        digest.update("|".join(repr(value) for value in row).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()
