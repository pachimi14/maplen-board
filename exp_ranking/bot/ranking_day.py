"""Ranking-day id: labels daily gain for the prior UTC calendar day."""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import config

logger = logging.getLogger(__name__)

UTC = ZoneInfo("UTC")
MIGRATION_MARKER_NAME = ".ranking_day_label_utc_gain"


def migration_marker_path() -> Path:
    return config.BASE_DIR / "data" / MIGRATION_MARKER_NAME


def ranking_day_from_fetch(dt: datetime) -> str:
    """Return the UTC gain day measured by a fetch at ``dt``.

    Official EXP resets at UTC 00:00 (= JST 09:00). A fetch on UTC date D
    reflects gain during UTC (D-1) 00:00–23:59, so the label is D-1.
    """
    if dt.tzinfo is None:
        current = dt.replace(tzinfo=UTC)
    else:
        current = dt.astimezone(UTC)
    return (current.date() - timedelta(days=1)).isoformat()


def shift_iso_date(iso_date: str, *, days: int) -> str:
    return (date.fromisoformat(iso_date) + timedelta(days=days)).isoformat()


def shift_chart_date(chart_date: str, *, days: int, year: int) -> str:
    month_str, day_str = chart_date.strip().split("/", 1)
    shifted = date(year, int(month_str), int(day_str)) + timedelta(days=days)
    return f"{shifted.month:02d}/{shifted.day:02d}"


def shift_mvp_json_dates(payload: dict[str, Any], *, days: int = -1) -> dict[str, Any]:
    meta = payload.get("meta")
    if not isinstance(meta, dict):
        return payload

    latest_raw = str(meta.get("latestSnapshotDate") or "").strip()
    year = int(latest_raw[:4]) if len(latest_raw) >= 4 else date.today().year
    if latest_raw:
        meta["latestSnapshotDate"] = shift_iso_date(latest_raw, days=days)
        year = int(meta["latestSnapshotDate"][:4])

    gain_periods = meta.get("gainPeriods")
    if isinstance(gain_periods, dict):
        for period in gain_periods.values():
            if not isinstance(period, dict):
                continue
            for key in ("periodStart", "periodEnd"):
                raw = str(period.get(key) or "").strip()
                if raw:
                    period[key] = shift_iso_date(raw, days=days)

    meta["rankingDayTimezone"] = "UTC"
    meta["rankingDayResetsAt"] = (
        "UTC 00:00 (= JST 09:00); snapshot label = prior UTC calendar day"
    )

    characters = payload.get("characters")
    if not isinstance(characters, list):
        return payload

    for character in characters:
        if not isinstance(character, dict):
            continue
        history = character.get("history")
        if not isinstance(history, list):
            continue
        for point in history:
            if not isinstance(point, dict):
                continue
            snapshot_raw = str(point.get("snapshotDate") or "").strip()
            if snapshot_raw:
                point["snapshotDate"] = shift_iso_date(snapshot_raw, days=days)
            chart_raw = str(point.get("date") or "").strip()
            if chart_raw and "/" in chart_raw:
                point["date"] = shift_chart_date(chart_raw, days=days, year=year)

    return payload


def shift_mvp_json_file(json_path: Path, *, days: int = -1) -> bool:
    if not json_path.exists():
        return False
    try:
        payload = json.loads(json_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Cannot shift MVP JSON %s: %s", json_path, exc)
        return False
    if not isinstance(payload, dict):
        return False
    shifted = shift_mvp_json_dates(payload, days=days)
    json_path.write_text(
        json.dumps(shifted, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    logger.info("Shifted MVP JSON snapshot dates by %s day(s): %s", days, json_path)
    return True


def shift_all_snapshot_dates(db_path: Path, *, days: int = -1) -> int:
    """Shift every ``snapshot_date`` by ``days`` (two-phase update for UNIQUE)."""
    from sqlite_storage import init_db

    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id, snapshot_date FROM ranking_snapshot ORDER BY id"
        ).fetchall()
        if not rows:
            return 0

        for row_id, snap_date in rows:
            conn.execute(
                "UPDATE ranking_snapshot SET snapshot_date = ? WHERE id = ?",
                (f"__shift__{snap_date}", row_id),
            )

        updated = 0
        for row_id, snap_date in rows:
            new_date = shift_iso_date(str(snap_date), days=days)
            conn.execute(
                "UPDATE ranking_snapshot SET snapshot_date = ? WHERE id = ?",
                (new_date, row_id),
            )
            updated += 1
        conn.commit()

    logger.info(
        "Shifted SQLite snapshot dates by %s day(s): rows=%s db=%s",
        days,
        updated,
        db_path,
    )
    return updated


def shift_ranking_day_skip_marker(*, days: int = -1) -> None:
    path = config.ranking_day_skip_marker_path()
    if not path.exists():
        return
    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        return
    try:
        shifted = shift_iso_date(raw, days=days)
    except ValueError:
        return
    path.write_text(shifted + "\n", encoding="utf-8")
    logger.info("Shifted ranking-day skip marker: %s -> %s", raw, shifted)


def migration_already_applied() -> bool:
    return migration_marker_path().exists()


def apply_ranking_day_label_migration(
    db_path: Path | None = None,
    *,
    days: int = -1,
) -> bool:
    """One-time shift of stored labels to UTC gain-day ids."""
    if migration_already_applied():
        return False

    db = db_path or config.sqlite_db_path()
    db.parent.mkdir(parents=True, exist_ok=True)

    shifted_rows = 0
    if db.exists():
        shifted_rows = shift_all_snapshot_dates(db, days=days)

    seen_json: set[Path] = set()
    json_paths: list[Path] = []
    for path in (
        config.mvp_json_output_path(),
        config.snapshot_seed_json_path(),
    ):
        resolved = path.resolve()
        if resolved in seen_json:
            continue
        seen_json.add(resolved)
        json_paths.append(path)

    shifted_json = 0
    for path in json_paths:
        if shift_mvp_json_file(path, days=days):
            shifted_json += 1

    shift_ranking_day_skip_marker(days=days)

    marker = migration_marker_path()
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(
        f"utc_gain_day shift={days} rows={shifted_rows} json_files={shifted_json}\n",
        encoding="utf-8",
    )
    logger.info(
        "Ranking-day label migration complete (shift=%s rows=%s json_files=%s)",
        days,
        shifted_rows,
        shifted_json,
    )
    return True
