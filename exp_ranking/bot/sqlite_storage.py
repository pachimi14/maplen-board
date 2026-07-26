"""SQLite storage for ranking snapshots."""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from models import SnapshotRow

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS ranking_snapshot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date TEXT NOT NULL,
    rank INTEGER NOT NULL,
    rank_fluctuation INTEGER NOT NULL DEFAULT 0,
    character_name TEXT NOT NULL,
    class_code TEXT NOT NULL DEFAULT '',
    job_code TEXT NOT NULL DEFAULT '',
    level INTEGER NOT NULL,
    exp INTEGER NOT NULL,
    image_url TEXT NOT NULL DEFAULT '',
    character_asset_key TEXT NOT NULL DEFAULT '',
    fetched_at TEXT NOT NULL,
    UNIQUE(snapshot_date, rank)
);

CREATE INDEX IF NOT EXISTS idx_ranking_snapshot_date
    ON ranking_snapshot(snapshot_date);

CREATE INDEX IF NOT EXISTS idx_ranking_snapshot_character
    ON ranking_snapshot(character_name);

CREATE INDEX IF NOT EXISTS idx_ranking_snapshot_empty_asset_name
    ON ranking_snapshot(character_name)
    WHERE character_asset_key IS NULL OR character_asset_key = '';

CREATE TABLE IF NOT EXISTS character_meta (
    character_asset_key TEXT PRIMARY KEY,
    world_id TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {str(row[1]) for row in rows}


def _migrate_schema(conn: sqlite3.Connection) -> None:
    snapshot_columns = _table_columns(conn, "ranking_snapshot")
    if "character_asset_key" not in snapshot_columns:
        conn.execute(
            """
            ALTER TABLE ranking_snapshot
            ADD COLUMN character_asset_key TEXT NOT NULL DEFAULT ''
            """
        )


# B' (IMPL_PLAN_recovery-era.md): recovery no longer parses a single
# `meta.expTable` and uses it for every row/link regardless of that row's
# own snapshotDate -- that single-table model is exactly the era bug this
# fix closes (see level_exp.exp_table_for / v2_recovery_backward.py, both of
# which now select a table per (row, its own date) instead). `meta.expTable`
# itself is no longer read for table selection; `meta.expTableVersion` is
# still read, but only as a safety-valve sanity check (below), not a source
# of truth for which table applies to a historical date.
_KNOWN_EXP_TABLE_VERSIONS: frozenset[str] | None = None


def _warn_if_unknown_exp_table_version(meta: dict, *, source: str) -> None:
    """Safety valve (LULU-062/B'): recovery now always derives each row's
    table from its own snapshotDate via level_exp.exp_table_for, which only
    knows about the eras hardcoded into level_exp._EXP_TABLE_ERAS. If the
    JSON's own `meta.expTableVersion` names a version this bot's level_exp.py
    doesn't recognize, era-based selection may silently disagree with the
    exporter's actual table for some historical dates -- warn so an operator
    notices rather than trusting a possibly-wrong recovered exp.
    """
    global _KNOWN_EXP_TABLE_VERSIONS
    if _KNOWN_EXP_TABLE_VERSIONS is None:
        from level_exp import EXP_TABLE_VERSION, LEGACY_EXP_TABLE_VERSION_PRE_2026_07_23

        _KNOWN_EXP_TABLE_VERSIONS = frozenset(
            {EXP_TABLE_VERSION, LEGACY_EXP_TABLE_VERSION_PRE_2026_07_23}
        )

    version = str(meta.get("expTableVersion") or "").strip()
    if version and version not in _KNOWN_EXP_TABLE_VERSIONS:
        logger.warning(
            "%s meta.expTableVersion=%r is not a version this bot's "
            "level_exp.py era table knows about; snapshot-date-based era "
            "selection (level_exp.exp_table_for) may not match the "
            "exporter's actual table for some historical dates -- verify "
            "before trusting recovered exp.",
            source,
            version,
        )

def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.executescript(_SCHEMA)
        _migrate_schema(conn)
        conn.commit()


def get_app_meta(db_path: Path, key: str) -> str | None:
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT value FROM app_meta WHERE key = ?",
            (key,),
        ).fetchone()
    if not row:
        return None
    value = str(row[0] or "").strip()
    return value or None


def set_app_meta(db_path: Path, key: str, value: str) -> None:
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO app_meta (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (key, value),
        )
        conn.commit()


LAST_RANKING_FETCHED_AT_KEY = "last_ranking_fetched_at"


def parse_iso_datetime(raw: str) -> datetime | None:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def latest_snapshot_fetched_at(db_path: Path) -> datetime | None:
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT fetched_at
            FROM ranking_snapshot
            WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM ranking_snapshot)
            ORDER BY fetched_at DESC
            LIMIT 1
            """
        ).fetchone()
    if not row:
        return None
    return parse_iso_datetime(str(row[0]))


def ensure_ranking_fetched_at_meta(db_path: Path, json_path: Path) -> None:
    if get_app_meta(db_path, LAST_RANKING_FETCHED_AT_KEY):
        return

    if json_path.exists():
        try:
            payload = json.loads(json_path.read_text(encoding="utf-8"))
            meta = payload.get("meta")
            if isinstance(meta, dict):
                raw = str(meta.get("updatedAt") or "").strip()
                parsed = parse_iso_datetime(raw)
                if parsed:
                    set_app_meta(
                        db_path,
                        LAST_RANKING_FETCHED_AT_KEY,
                        parsed.isoformat(timespec="seconds"),
                    )
                    return
        except (OSError, json.JSONDecodeError):
            pass

    from_db = latest_snapshot_fetched_at(db_path)
    if from_db:
        set_app_meta(
            db_path,
            LAST_RANKING_FETCHED_AT_KEY,
            from_db.isoformat(timespec="seconds"),
        )


def reconcile_ranking_fetched_at_meta(db_path: Path) -> bool:
    """Raise app_meta last_ranking_fetched_at when snapshots have a newer fetched_at."""
    from_db = latest_snapshot_fetched_at(db_path)
    if not from_db:
        return False

    stored = get_app_meta(db_path, LAST_RANKING_FETCHED_AT_KEY)
    stored_dt = parse_iso_datetime(stored) if stored else None
    if stored_dt is not None and stored_dt >= from_db:
        return False

    set_app_meta(
        db_path,
        LAST_RANKING_FETCHED_AT_KEY,
        from_db.isoformat(timespec="seconds"),
    )
    return True


def append_snapshots(
    db_path: Path,
    rows: list[SnapshotRow],
    fetched_at: str,
) -> tuple[int, int]:
    init_db(db_path)
    saved = 0
    skipped = 0

    with sqlite3.connect(db_path) as conn:
        for row in rows:
            cursor = conn.execute(
                """
                INSERT OR IGNORE INTO ranking_snapshot (
                    snapshot_date, rank, rank_fluctuation, character_name,
                    class_code, job_code, level, exp, image_url,
                    character_asset_key, fetched_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row.snapshot_date,
                    row.rank,
                    row.rank_fluctuation,
                    row.character_name,
                    row.class_code,
                    row.job_code,
                    row.level,
                    row.exp,
                    row.image_url,
                    row.character_asset_key,
                    fetched_at,
                ),
            )
            if cursor.rowcount > 0:
                saved += 1
            else:
                skipped += 1
        conn.commit()

    logger.info(
        "SQLite snapshot: saved=%s skipped=%s db=%s",
        saved,
        skipped,
        db_path,
    )
    return saved, skipped


def load_all_snapshots(db_path: Path) -> list[SnapshotRow]:
    if not db_path.exists():
        return []

    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT
                snapshot_date, rank, rank_fluctuation, character_name,
                class_code, job_code, level, exp, image_url, character_asset_key
            FROM ranking_snapshot
            ORDER BY snapshot_date ASC, rank ASC
            """
        ).fetchall()

    return [
        SnapshotRow(
            snapshot_date=str(row["snapshot_date"]),
            rank=int(row["rank"]),
            rank_fluctuation=int(row["rank_fluctuation"]),
            character_name=str(row["character_name"]),
            class_code=str(row["class_code"]),
            job_code=str(row["job_code"]),
            level=int(row["level"]),
            exp=int(row["exp"]),
            image_url=str(row["image_url"]),
            character_asset_key=str(row["character_asset_key"] or ""),
        )
        for row in rows
    ]


def checkpoint_db(db_path: Path) -> None:
    if not db_path.exists():
        return
    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.commit()


def export_character_meta_file(db_path: Path, meta_json_path: Path) -> int:
    import json

    meta = {
        key: value
        for key, value in load_character_meta(db_path).items()
        if key and str(value).strip()
    }
    meta_json_path.parent.mkdir(parents=True, exist_ok=True)
    meta_json_path.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    logger.info("Exported character_meta.json: %s keys -> %s", len(meta), meta_json_path)
    return len(meta)


def import_character_meta_file(db_path: Path, meta_json_path: Path) -> int:
    import json

    if not meta_json_path.exists():
        return 0

    try:
        payload = json.loads(meta_json_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 0

    if not isinstance(payload, dict):
        return 0

    from datetime import datetime, timezone

    updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    imported = 0
    for asset_key, world_id in payload.items():
        key = str(asset_key).strip()
        world = str(world_id).strip()
        if not key or not world:
            continue
        upsert_character_meta(db_path, key, world, updated_at)
        imported += 1

    if imported:
        logger.info(
            "Imported character_meta.json: %s keys from %s",
            imported,
            meta_json_path,
        )
    return imported


def hydrate_character_meta_from_url(db_path: Path, url: str) -> int:
    """Load worldId from the last deployed rankings.json (GitHub Pages)."""
    import json

    import requests

    if not url:
        return 0

    try:
        response = requests.get(
            url,
            timeout=120,
            headers={
                "Accept": "application/json",
                "User-Agent": "msu-ranking-bot/1.0",
            },
        )
        if response.status_code != 200:
            logger.warning(
                "Pages rankings.json not available for hydrate: HTTP %s",
                response.status_code,
            )
            return 0
        payload = response.json()
    except Exception as exc:
        logger.warning("Pages rankings.json hydrate failed: %s", exc)
        return 0

    characters = payload.get("characters")
    if not isinstance(characters, list):
        return 0

    from datetime import datetime, timezone

    updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    imported = 0
    for character in characters:
        if not isinstance(character, dict):
            continue
        asset_key = str(character.get("characterAssetKey") or "").strip()
        world_id = str(character.get("worldId") or "").strip()
        if not asset_key or not world_id:
            continue
        upsert_character_meta(db_path, asset_key, world_id, updated_at)
        imported += 1

    if imported:
        logger.info(
            "Hydrated character_meta from Pages JSON: %s keys (%s)",
            imported,
            url,
        )
    return imported


def count_character_meta(db_path: Path) -> int:
    if not db_path.exists():
        return 0
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM character_meta WHERE world_id != ''"
        ).fetchone()
    return int(row[0]) if row else 0


def hydrate_character_meta_from_json(db_path: Path, json_path: Path) -> int:
    """Import worldId from an existing rankings.json into character_meta."""
    import json

    if not json_path.exists():
        return 0

    try:
        payload = json.loads(json_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 0

    characters = payload.get("characters")
    if not isinstance(characters, list):
        return 0

    from datetime import datetime, timezone

    updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    imported = 0
    for character in characters:
        if not isinstance(character, dict):
            continue
        asset_key = str(character.get("characterAssetKey") or "").strip()
        world_id = str(character.get("worldId") or "").strip()
        if not asset_key or not world_id:
            continue
        upsert_character_meta(db_path, asset_key, world_id, updated_at)
        imported += 1

    if imported:
        logger.info(
            "Hydrated character_meta from JSON: %s rows from %s",
            imported,
            json_path,
        )
    return imported


def load_character_meta(db_path: Path) -> dict[str, str]:
    if not db_path.exists():
        return {}

    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT character_asset_key, world_id
            FROM character_meta
            WHERE character_asset_key != ''
            """
        ).fetchall()

    return {
        str(row[0]): str(row[1] or "")
        for row in rows
        if str(row[1] or "").strip()
    }


def upsert_character_meta(
    db_path: Path,
    character_asset_key: str,
    world_id: str,
    updated_at: str,
) -> None:
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO character_meta (character_asset_key, world_id, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(character_asset_key) DO UPDATE SET
                world_id = excluded.world_id,
                updated_at = excluded.updated_at
            """,
            (character_asset_key, world_id, updated_at),
        )
        conn.commit()


def count_snapshots(db_path: Path) -> int:
    if not db_path.exists():
        return 0
    with sqlite3.connect(db_path) as conn:
        result = conn.execute("SELECT COUNT(*) FROM ranking_snapshot").fetchone()
    return int(result[0]) if result else 0


def delete_snapshots_before(db_path: Path, cutoff_date: str) -> int:
    """Delete rows with snapshot_date strictly before cutoff_date."""
    if not db_path.exists():
        return 0

    with sqlite3.connect(db_path) as conn:
        cursor = conn.execute(
            "DELETE FROM ranking_snapshot WHERE snapshot_date < ?",
            (cutoff_date,),
        )
        deleted = cursor.rowcount
        conn.commit()

    logger.info(
        "Deleted snapshots before %s: rows=%s db=%s",
        cutoff_date,
        deleted,
        db_path,
    )
    return deleted


def latest_snapshot_date(db_path: Path) -> str | None:
    if not db_path.exists():
        return None
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT MAX(snapshot_date) FROM ranking_snapshot"
        ).fetchone()
    return str(row[0]) if row and row[0] else None


def load_snapshot_state_before(
    db_path: Path,
    before_date: str,
) -> tuple[str | None, list[tuple[int, str, int, int]]]:
    """Load the newest complete comparison snapshot before ``before_date``."""
    if not db_path.exists():
        return None, []
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT MAX(snapshot_date) FROM ranking_snapshot WHERE snapshot_date < ?",
            (before_date,),
        ).fetchone()
        snapshot_date = str(row[0]) if row and row[0] else None
        if not snapshot_date:
            return None, []
        rows = conn.execute(
            """
            SELECT rank, character_name, level, exp
            FROM ranking_snapshot
            WHERE snapshot_date = ?
            ORDER BY rank ASC
            """,
            (snapshot_date,),
        ).fetchall()
    return snapshot_date, [
        (int(rank), str(name), int(level), int(exp))
        for rank, name, level, exp in rows
    ]


def has_snapshots_for_date(db_path: Path, snapshot_date: str) -> bool:
    if not snapshot_date or not db_path.exists():
        return False
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT 1 FROM ranking_snapshot WHERE snapshot_date = ? LIMIT 1",
            (snapshot_date,),
        ).fetchone()
    return row is not None


def count_snapshots_for_date(db_path: Path, snapshot_date: str) -> int:
    if not snapshot_date or not db_path.exists():
        return 0
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM ranking_snapshot WHERE snapshot_date = ?",
            (snapshot_date,),
        ).fetchone()
    return int(row[0]) if row else 0


def list_snapshot_dates(db_path: Path) -> list[str]:
    if not db_path.exists():
        return []
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT DISTINCT snapshot_date FROM ranking_snapshot ORDER BY snapshot_date"
        ).fetchall()
    return [str(row[0]) for row in rows if row[0]]


def snapshot_dates_in_mvp_json(json_path: Path) -> set[str]:
    import json

    try:
        payload = json.loads(json_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()

    meta = payload.get("meta")
    characters = payload.get("characters")
    if not isinstance(meta, dict) or not isinstance(characters, list):
        return set()

    latest_date = str(meta.get("latestSnapshotDate") or "").strip()
    if not latest_date:
        return set()

    dates: set[str] = set()
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
                dates.add(snapshot_raw)
                continue
            chart_date = str(point.get("date") or "").strip()
            if chart_date and "/" in chart_date:
                dates.add(_chart_date_to_iso(chart_date, latest_date))
    return dates


def count_snapshot_dates(db_path: Path) -> int:
    if not db_path.exists():
        return 0
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT COUNT(DISTINCT snapshot_date) FROM ranking_snapshot"
        ).fetchone()
    return int(row[0]) if row else 0


def backfill_character_asset_keys(
    db_path: Path,
    *,
    name_to_asset_key: dict[str, str] | None = None,
) -> int:
    """Fill missing asset keys on past days using today's name -> asset key map."""
    from identity import build_name_to_asset_key

    if not name_to_asset_key:
        snapshots = load_all_snapshots(db_path)
        if not snapshots:
            return 0
        name_to_asset_key = build_name_to_asset_key(snapshots)

    if not name_to_asset_key:
        return 0

    normalized = {
        str(name_key or "").casefold(): str(asset_key or "").strip()
        for name_key, asset_key in name_to_asset_key.items()
        if str(name_key or "").strip() and str(asset_key or "").strip()
    }
    if not normalized:
        return 0

    updated = 0
    with sqlite3.connect(db_path) as conn:
        missing_rows = conn.execute(
            """
            SELECT DISTINCT lower(character_name)
            FROM ranking_snapshot
            WHERE (character_asset_key IS NULL OR character_asset_key = '')
              AND character_name != ''
            """
        ).fetchall()
        missing_names = {
            str(row[0] or "").casefold()
            for row in missing_rows
            if str(row[0] or "").strip()
        }
        if not missing_names:
            logger.info("Skipped character_asset_key backfill: no empty asset keys")
            return 0

        pending = {
            name_key: asset_key
            for name_key, asset_key in normalized.items()
            if name_key in missing_names
        }
        if not pending:
            logger.info(
                "Skipped character_asset_key backfill: %s empty-name groups, no matches",
                len(missing_names),
            )
            return 0

        for name_key, asset_key in pending.items():
            cursor = conn.execute(
                """
                UPDATE ranking_snapshot
                SET character_asset_key = ?
                WHERE lower(character_name) = ?
                  AND (character_asset_key IS NULL OR character_asset_key = '')
                """,
                (asset_key, name_key),
            )
            updated += cursor.rowcount
        conn.commit()

    if updated:
        logger.info(
            "Complemented character_asset_key on %s rows (%s matched names, %s empty-name groups)",
            updated,
            len(pending),
            len(missing_names),
        )
    return updated


def _chart_date_to_iso(chart_date: str, latest_snapshot_date: str) -> str:
    from datetime import date

    month_str, day_str = chart_date.strip().split("/", 1)
    month = int(month_str)
    day = int(day_str)
    year = int(latest_snapshot_date[:4])
    candidate = date(year, month, day)
    latest = date.fromisoformat(latest_snapshot_date)
    if candidate > latest:
        candidate = date(year - 1, month, day)
    return candidate.isoformat()


def import_missing_snapshots_from_url(db_path: Path, url: str) -> int:
    """Import snapshot days present in remote rankings.json but missing in DB."""
    import tempfile
    import urllib.error
    import urllib.request

    init_db(db_path)
    db_dates = set(list_snapshot_dates(db_path))

    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        temp_path = Path(tmp.name)

    try:
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                temp_path.write_bytes(response.read())
        except (OSError, urllib.error.URLError) as exc:
            logger.warning("Cannot download rankings.json from %s: %s", url, exc)
            return 0

        json_dates = snapshot_dates_in_mvp_json(temp_path)
        missing = sorted(json_dates - db_dates)
        if not missing:
            logger.info(
                "Pages rankings.json has no missing snapshot days for DB (days=%s)",
                len(db_dates),
            )
            return 0

        logger.info(
            "Importing missing snapshot days from %s: %s",
            url,
            missing,
        )
        return import_snapshots_from_mvp_json(db_path, temp_path)
    finally:
        temp_path.unlink(missing_ok=True)


def import_snapshots_from_mvp_json(db_path: Path, json_path: Path) -> int:
    """Rebuild SQLite snapshot rows from rankings.json history (recovery)."""
    import json
    from collections import defaultdict
    from datetime import datetime, timezone


    try:
        payload = json.loads(json_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Cannot import snapshots from %s: %s", json_path, exc)
        return 0

    characters = payload.get("characters")
    meta = payload.get("meta")
    if not isinstance(characters, list) or not isinstance(meta, dict):
        return 0

    latest_date = str(meta.get("latestSnapshotDate") or "").strip()
    if not latest_date:
        return 0

    updated_raw = str(meta.get("updatedAt") or "").strip()
    fetched_at = updated_raw or datetime.now(timezone.utc).isoformat(timespec="seconds")
    _warn_if_unknown_exp_table_version(meta, source="rankings.json")

    from level_exp import exp_table_for

    pending: dict[str, list[dict[str, object]]] = defaultdict(list)
    for character in characters:
        if not isinstance(character, dict):
            continue
        name = str(character.get("name") or "").strip()
        if not name:
            continue
        asset_key = str(character.get("characterAssetKey") or "").strip()
        latest_rank = int(character.get("rank") or 0)
        image_url = str(character.get("imageUrl") or "").strip()
        history = character.get("history")
        if not isinstance(history, list):
            continue

        for point in history:
            if not isinstance(point, dict):
                continue
            snapshot_raw = str(point.get("snapshotDate") or "").strip()
            if snapshot_raw:
                snapshot_date = snapshot_raw
            else:
                chart_date = str(point.get("date") or "").strip()
                if not chart_date or "/" not in chart_date:
                    continue
                snapshot_date = _chart_date_to_iso(chart_date, latest_date)
            level = int(point.get("level") or 0)
            percent = float(
                point.get("levelExpPercent")
                if point.get("levelExpPercent") is not None
                else point.get("expPercent") or 0
            )
            # Era-aware (B'): each point's own snapshotDate picks its own
            # table -- a single table for the whole import (the previous
            # behavior, sourced from meta.expTable or a current-table
            # fallback) mis-converts percent->exp for any point whose era
            # differs from that one table (see docs/DECISION_LOG.md LULU-062).
            required = exp_table_for(snapshot_date).get(level)
            exp = int(required * percent / 100.0) if required else 0
            pending[snapshot_date].append(
                {
                    "name": name,
                    "asset_key": asset_key,
                    "level": level,
                    "exp": exp,
                    "image_url": image_url,
                    "sort_rank": latest_rank if latest_rank > 0 else 999_999,
                }
            )

    if not pending:
        return 0

    init_db(db_path)
    imported = 0
    for snapshot_date in sorted(pending.keys()):
        entries = sorted(
            pending[snapshot_date],
            key=lambda item: (int(item["sort_rank"]), str(item["name"]).casefold()),
        )
        rows: list[SnapshotRow] = []
        for rank, entry in enumerate(entries, start=1):
            rows.append(
                SnapshotRow(
                    snapshot_date=snapshot_date,
                    rank=rank,
                    rank_fluctuation=0,
                    character_name=str(entry["name"]),
                    class_code="",
                    job_code="",
                    level=int(entry["level"]),
                    exp=int(entry["exp"]),
                    image_url=str(entry["image_url"]),
                    character_asset_key=str(entry["asset_key"]),
                )
            )
        saved, _ = append_snapshots(db_path, rows, fetched_at)
        imported += saved

    if imported:
        logger.info(
            "Imported snapshot rows from MVP JSON: saved=%s days=%s source=%s",
            imported,
            count_snapshot_dates(db_path),
            json_path,
        )
        from identity import build_name_to_asset_key_from_mvp_characters

        name_to_key = build_name_to_asset_key_from_mvp_characters(characters)
        if name_to_key:
            backfill_character_asset_keys(db_path, name_to_asset_key=name_to_key)

    return imported


UNIQUE_SNAPSHOT_IDENTITY_INDEX = "idx_ranking_snapshot_date_asset_key"


def find_duplicate_snapshot_identity_groups(db_path: Path) -> list[dict]:
    """Find `(snapshot_date, character_asset_key)` groups with more than one row.

    Only rows with a non-empty `character_asset_key` are considered -- legacy
    name-only rows are out of scope for the partial unique index (see
    docs/IMPL_PLAN_dq-dup-rows.md P-DQ-3 §4). For each group, the row to keep
    is picked by `analysis.select_canonical_snapshot_row` (LULU-055/057) --
    that rule is reused as-is (not re-implemented here) so the primary-row
    rule stays defined in exactly one place, matching the P-DQ-1 output-side
    aggregation (`analysis.deduplicate_snapshots_by_identity`).
    """
    from analysis import select_canonical_snapshot_row

    if not db_path.exists():
        return []
    init_db(db_path)

    groups: list[dict] = []
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        dup_keys = conn.execute(
            """
            SELECT snapshot_date, character_asset_key
            FROM ranking_snapshot
            WHERE character_asset_key != ''
            GROUP BY snapshot_date, character_asset_key
            HAVING COUNT(*) > 1
            """
        ).fetchall()

        for dup in dup_keys:
            snapshot_date = str(dup["snapshot_date"])
            asset_key = str(dup["character_asset_key"])
            rows = conn.execute(
                """
                SELECT id, snapshot_date, rank, rank_fluctuation, character_name,
                       class_code, job_code, level, exp, image_url,
                       character_asset_key, fetched_at
                FROM ranking_snapshot
                WHERE snapshot_date = ? AND character_asset_key = ?
                """,
                (snapshot_date, asset_key),
            ).fetchall()

            snapshot_rows = [
                SnapshotRow(
                    snapshot_date=str(row["snapshot_date"]),
                    rank=int(row["rank"]),
                    rank_fluctuation=int(row["rank_fluctuation"]),
                    character_name=str(row["character_name"]),
                    class_code=str(row["class_code"]),
                    job_code=str(row["job_code"]),
                    level=int(row["level"]),
                    exp=int(row["exp"]),
                    image_url=str(row["image_url"]),
                    character_asset_key=str(row["character_asset_key"] or ""),
                )
                for row in rows
            ]
            canonical = select_canonical_snapshot_row(snapshot_rows)
            row_by_id = {int(row["id"]): dict(row) for row in rows}
            # `rank` is unique per snapshot_date (UNIQUE(snapshot_date, rank)),
            # so it unambiguously maps the canonical SnapshotRow back to its id.
            keep_id = next(
                row_id
                for row_id, row in row_by_id.items()
                if int(row["rank"]) == canonical.rank
            )
            delete_ids = [row_id for row_id in row_by_id if row_id != keep_id]

            groups.append(
                {
                    "snapshot_date": snapshot_date,
                    "character_asset_key": asset_key,
                    "keep_id": keep_id,
                    "delete_ids": delete_ids,
                    "rows": row_by_id,
                }
            )
    return groups


def dedupe_ranking_snapshot_identity_rows(
    db_path: Path,
    *,
    dry_run: bool = True,
) -> dict:
    """Delete excess rows within duplicate `(snapshot_date, character_asset_key)`
    groups, keeping exactly one row per group (see
    `find_duplicate_snapshot_identity_groups` for the selection rule).

    Always computes and returns a full backup (id + every column value) of
    the rows that would be/were deleted, regardless of `dry_run`, so the
    operation is reversible. When `dry_run` is True (the default) no row is
    deleted -- this only reports the plan. See docs/IMPL_PLAN_dq-dup-rows.md
    P-DQ-3.
    """
    groups = find_duplicate_snapshot_identity_groups(db_path)
    delete_ids: list[int] = []
    backup_rows: list[dict] = []
    for group in groups:
        for row_id in group["delete_ids"]:
            delete_ids.append(row_id)
            backup_rows.append(group["rows"][row_id])

    result = {
        "groups": len(groups),
        "rows_deleted": len(delete_ids),
        "backup_rows": backup_rows,
        "dry_run": dry_run,
    }

    if dry_run or not delete_ids:
        return result

    with sqlite3.connect(db_path) as conn:
        conn.executemany(
            "DELETE FROM ranking_snapshot WHERE id = ?",
            [(row_id,) for row_id in delete_ids],
        )
        conn.commit()

    logger.info(
        "Deduplicated ranking_snapshot (snapshot_date, character_asset_key): "
        "groups=%s rows_deleted=%s db=%s",
        len(groups),
        len(delete_ids),
        db_path,
    )
    return result


def create_unique_snapshot_identity_index(db_path: Path) -> None:
    """Create the partial `UNIQUE(snapshot_date, character_asset_key)` index.

    `WHERE character_asset_key != ''` excludes legacy name-only rows (never
    backfilled with an asset key) from the constraint, matching existing
    read-side compatibility (see docs/IMPL_PLAN_dq-dup-rows.md P-DQ-3 §4).
    Idempotent (`IF NOT EXISTS`). Must be called only after
    `dedupe_ranking_snapshot_identity_rows` has removed existing duplicate
    `(snapshot_date, character_asset_key)` rows -- otherwise index creation
    raises `sqlite3.IntegrityError`.
    """
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            f"""
            CREATE UNIQUE INDEX IF NOT EXISTS {UNIQUE_SNAPSHOT_IDENTITY_INDEX}
            ON ranking_snapshot(snapshot_date, character_asset_key)
            WHERE character_asset_key != ''
            """
        )
        conn.commit()


def migrate_unique_snapshot_identity_constraint(
    db_path: Path,
    *,
    dry_run: bool = True,
) -> dict:
    """One-time migration: dedupe `(snapshot_date, character_asset_key)` rows,
    then create the partial unique index. Order matters -- see
    `create_unique_snapshot_identity_index`.

    Idempotent: once no duplicates remain and the index exists, a subsequent
    call is a no-op (`dedupe.groups == 0`, `dedupe.rows_deleted == 0`, index
    left as-is).

    Not wired into `init_db`/`_migrate_schema` or `main.py` -- real-DB
    application requires a separate, explicit invocation and sign-off (see
    docs/IMPL_PLAN_dq-dup-rows.md P-DQ-3).
    """
    dedupe_result = dedupe_ranking_snapshot_identity_rows(db_path, dry_run=dry_run)
    index_created = False
    if not dry_run:
        create_unique_snapshot_identity_index(db_path)
        index_created = True
    return {"dedupe": dedupe_result, "index_created": index_created}
def _merge_v2_shard_histories(
    shard_payloads: dict[int, dict] | list[dict] | None,
) -> dict[str, list[dict]]:
    """Flatten {shard_index: {historyKey: history}} (or a list of shard payloads)
    into a single historyKey -> history map."""
    histories_by_key: dict[str, list[dict]] = {}
    if not shard_payloads:
        return histories_by_key

    shard_iterable = (
        shard_payloads.values() if isinstance(shard_payloads, dict) else shard_payloads
    )
    for shard_payload in shard_iterable:
        if not isinstance(shard_payload, dict):
            continue
        histories = shard_payload.get("histories")
        if not isinstance(histories, dict):
            continue
        for history_key, history in histories.items():
            if isinstance(history, list):
                histories_by_key[str(history_key)] = history
    return histories_by_key


def import_snapshots_from_v2_json(
    db_path: Path,
    summary_payload: dict,
    shard_payloads: dict[int, dict] | list[dict] | None,
) -> int:
    """Rebuild SQLite snapshot rows from v2 rankings.json summary + shard-NN.json
    history JSON (recovery; T12 P1). Worst-case path used when neither
    actions/cache, a Release Asset, nor a git-committed db.gz is available.

    Per character, walks backward from the exact anchor (latest) day's exp --
    taken verbatim from the summary -- using each day's own exact dailyGain
    and level (see v2_recovery_backward.reconstruct_exp_backward for the full
    algorithm and rationale). This never restores an exp/dailyGain value
    larger than the true one, and never drops a day (falls back to a
    conservative, never-over percent inversion when the exact chain breaks).

    Additive: reconstructed (snapshot_date, identity) pairs that already exist
    in the DB are filtered out *before* insertion (identity = asset key, or
    `name:<casefolded name>` for the rare rows without one -- same convention
    as identity.py/mvp_export.py's historyKey). This is on top of, not
    instead of, append_snapshots' own INSERT OR IGNORE (which only dedupes on
    the synthetic (snapshot_date, rank) the recovery path itself assigns and
    would not by itself catch two different rows for the same day/character).
    Without this filter, re-running recovery against a DB that already has
    some of those days (e.g. a partially-warm cache) would add a *second*,
    differently-ranked row for the same real character/day -- not an
    overwrite, but a duplicate the additive-merge guarantee (INV-3) doesn't
    allow either. The existing-identity set is fetched once (single query),
    not per character/row.
    """
    from collections import defaultdict
    from datetime import datetime, timezone

    from v2_recovery_backward import reconstruct_exp_backward

    characters = summary_payload.get("characters") if summary_payload else None
    meta = summary_payload.get("meta") if summary_payload else None
    if not isinstance(characters, list) or not isinstance(meta, dict):
        return 0

    latest_date = str(meta.get("latestSnapshotDate") or "").strip()
    if not latest_date:
        return 0

    updated_raw = str(meta.get("updatedAt") or "").strip()
    fetched_at = updated_raw or datetime.now(timezone.utc).isoformat(timespec="seconds")
    _warn_if_unknown_exp_table_version(meta, source="v2 rankings.json")

    # worldId is exact (no reconstruction) in the v2 summary; hydrate character_meta
    # unconditionally so worldRank/worldRankTotal survive recovery too.
    meta_hydrated = 0
    for character in characters:
        if not isinstance(character, dict):
            continue
        meta_asset_key = str(character.get("characterAssetKey") or "").strip()
        world_id = str(character.get("worldId") or "").strip()
        if not meta_asset_key or not world_id:
            continue
        upsert_character_meta(db_path, meta_asset_key, world_id, fetched_at)
        meta_hydrated += 1
    if meta_hydrated:
        logger.info(
            "Hydrated character_meta from v2 summary: %s rows",
            meta_hydrated,
        )

    # Idempotency/additive guard: one query for every (snapshot_date, identity)
    # already in the DB, so the per-character loop below is a plain set
    # membership check (no N+1 queries).
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        existing_rows = conn.execute(
            "SELECT DISTINCT snapshot_date, character_asset_key, character_name "
            "FROM ranking_snapshot"
        ).fetchall()
    existing_identity_dates: set[tuple[str, str]] = set()
    for existing_date, existing_asset_key, existing_name in existing_rows:
        existing_identity = str(existing_asset_key or "").strip() or (
            f"name:{str(existing_name or '').strip().casefold()}"
        )
        existing_identity_dates.add((str(existing_date), existing_identity))

    histories_by_key = _merge_v2_shard_histories(shard_payloads)

    pending: dict[str, list[dict[str, object]]] = defaultdict(list)
    recon_stats = {"exact": 0, "conservative_fallback": 0, "unrecoverable": 0}
    skipped_existing = 0
    for character in characters:
        if not isinstance(character, dict):
            continue
        name = str(character.get("name") or "").strip()
        if not name:
            continue
        history_key = str(character.get("historyKey") or "").strip()
        history = histories_by_key.get(history_key)
        if not isinstance(history, list) or not history:
            continue
        asset_key = str(character.get("characterAssetKey") or "").strip()
        # Same identity convention as historyKey (identity.py): prefer the
        # asset key; fall back to a casefolded name so the (rare) rows
        # without one still get an idempotency check instead of being
        # exempted from it.
        identity = asset_key or f"name:{name.casefold()}"
        latest_rank = int(character.get("rank") or 0)
        image_url = str(character.get("imageUrl") or "").strip()
        summary_level = character.get("level")
        summary_exp = character.get("exp")
        if summary_level is None or summary_exp is None:
            continue

        points_desc: list[dict] = []
        for point in history:
            if not isinstance(point, dict):
                continue
            snapshot_date = str(point.get("snapshotDate") or "").strip()
            if not snapshot_date:
                # Defensive fallback for older/legacy JSON that only carries
                # the short "MM/DD" chart label (mirrors
                # import_snapshots_from_mvp_json's v1 behavior); current
                # mvp_export.py always writes snapshotDate.
                chart_date = str(point.get("date") or "").strip()
                if not chart_date or "/" not in chart_date:
                    continue
                snapshot_date = _chart_date_to_iso(chart_date, latest_date)
                if not snapshot_date:
                    continue
            points_desc.append({**point, "snapshotDate": snapshot_date})
        if not points_desc:
            continue
        points_desc.sort(key=lambda point: point["snapshotDate"], reverse=True)

        # Era-aware (B'): no `exp_table` override -- reconstruct_exp_backward
        # picks each link's table from that link's own destination-day
        # snapshotDate (level_exp.exp_table_for) instead of one table fixed
        # for this whole character (the previous behavior, sourced from
        # meta.expTable / a current-table fallback above, which is what let
        # a level-up whose destination day fell in a different era than
        # `EXP_TABLE_VERSION` over-restore dailyGain; see
        # docs/DECISION_LOG.md LULU-062).
        reconstructed = reconstruct_exp_backward(
            anchor_date=latest_date,
            anchor_level=int(summary_level),
            anchor_exp=int(summary_exp),
            points_desc=points_desc,
        )

        # A duplicated snapshotDate in `history` (see reconstruct_exp_backward's
        # docstring) means this character's own points_desc can carry two
        # entries for the same date, so `reconstructed` can too. Both are
        # individually <= the true exp (never-over guarantee), so keep only
        # the larger -- still <= true, and the tighter of the two safe
        # under-estimates -- rather than emitting two rows for one identity
        # on one day (which INSERT OR IGNORE's (snapshot_date, rank) key
        # would not by itself catch, since each gets its own synthetic rank).
        best_by_date: dict[str, object] = {}
        for day in reconstructed:
            recon_stats[day.method] = recon_stats.get(day.method, 0) + 1
            if day.exp is None or not day.snapshot_date:
                continue
            current_best = best_by_date.get(day.snapshot_date)
            if current_best is None or day.exp > current_best.exp:
                best_by_date[day.snapshot_date] = day

        for snapshot_date, day in best_by_date.items():
            if (snapshot_date, identity) in existing_identity_dates:
                skipped_existing += 1
                continue
            pending[snapshot_date].append(
                {
                    "name": name,
                    "asset_key": asset_key,
                    "level": day.level,
                    "exp": day.exp,
                    "image_url": image_url,
                    "sort_rank": latest_rank if latest_rank > 0 else 999_999,
                }
            )

    if not pending:
        if skipped_existing:
            logger.info(
                "v2 shard recovery: nothing to import, %s reconstructed rows "
                "already present (idempotent no-op)",
                skipped_existing,
            )
        return 0

    logger.info(
        "v2 shard backward reconstruction: exact=%s conservative_fallback=%s "
        "unrecoverable=%s skipped_existing=%s",
        recon_stats.get("exact", 0),
        recon_stats.get("conservative_fallback", 0),
        recon_stats.get("unrecoverable", 0),
        skipped_existing,
    )

    imported = 0
    for snapshot_date in sorted(pending.keys()):
        entries = sorted(
            pending[snapshot_date],
            key=lambda item: (int(item["sort_rank"]), str(item["name"]).casefold()),
        )
        rows: list[SnapshotRow] = []
        for rank, entry in enumerate(entries, start=1):
            rows.append(
                SnapshotRow(
                    snapshot_date=snapshot_date,
                    rank=rank,
                    rank_fluctuation=0,
                    character_name=str(entry["name"]),
                    class_code="",
                    job_code="",
                    level=int(entry["level"]),
                    exp=int(entry["exp"]),
                    image_url=str(entry["image_url"]),
                    character_asset_key=str(entry["asset_key"]),
                )
            )
        saved, _ = append_snapshots(db_path, rows, fetched_at)
        imported += saved

    if imported:
        logger.info(
            "Imported snapshot rows from v2 shard JSON: saved=%s days=%s",
            imported,
            count_snapshot_dates(db_path),
        )
        from identity import build_name_to_asset_key_from_mvp_characters

        name_to_key = build_name_to_asset_key_from_mvp_characters(characters)
        if name_to_key:
            backfill_character_asset_keys(db_path, name_to_asset_key=name_to_key)

    return imported


def import_missing_snapshots_from_v2_url(db_path: Path, summary_url: str) -> int:
    """Import snapshot days present in remote v2 rankings.json + shard-NN.json
    files but missing in DB. Worst-case recovery path (P1): used when neither
    actions/cache, a Release Asset, nor a git-committed db.gz is available.
    """
    import json
    import urllib.error
    import urllib.request

    init_db(db_path)

    def _fetch_json(url: str) -> dict | None:
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                return json.loads(response.read().decode("utf-8"))
        except (OSError, urllib.error.URLError, json.JSONDecodeError, ValueError) as exc:
            logger.warning("Cannot download %s: %s", url, exc)
            return None

    summary_payload = _fetch_json(summary_url)
    if not summary_payload:
        return 0

    meta = summary_payload.get("meta")
    if not isinstance(meta, dict):
        logger.warning("v2 rankings.json at %s has no meta", summary_url)
        return 0

    history_base_path = str(meta.get("historyBasePath") or "").strip().strip("/")
    shard_count = int(meta.get("historyShardCount") or 0)
    if not history_base_path or shard_count <= 0:
        logger.warning(
            "v2 rankings.json missing historyBasePath/historyShardCount (%s)",
            summary_url,
        )
        return 0

    v2_root = summary_url.rsplit("/", 1)[0]
    shard_payloads: dict[int, dict] = {}
    for shard in range(shard_count):
        shard_url = f"{v2_root}/{history_base_path}/shard-{shard:02d}.json"
        shard_payload = _fetch_json(shard_url)
        if shard_payload:
            shard_payloads[shard] = shard_payload

    if not shard_payloads:
        logger.warning("No v2 history shards could be downloaded from %s", v2_root)
        return 0

    imported = import_snapshots_from_v2_json(db_path, summary_payload, shard_payloads)
    if imported:
        logger.info(
            "Imported v2 shard recovery snapshots from %s: +%s rows (shards=%s/%s)",
            summary_url,
            imported,
            len(shard_payloads),
            shard_count,
        )
    return imported


def merge_ranking_databases(primary_path: Path, secondary_path: Path) -> int:
    """Copy missing snapshot rows from a legacy DB into the primary DB."""
    if not secondary_path.exists():
        return 0

    init_db(primary_path)
    init_db(secondary_path)

    before = count_snapshot_dates(primary_path)

    with sqlite3.connect(secondary_path) as legacy_conn:
        legacy_rows = legacy_conn.execute(
            """
            SELECT
                snapshot_date, rank, rank_fluctuation, character_name,
                class_code, job_code, level, exp, image_url,
                character_asset_key, fetched_at
            FROM ranking_snapshot
            """
        ).fetchall()

    if not legacy_rows:
        return 0

    merged = 0
    insert_sql = """
        INSERT OR IGNORE INTO ranking_snapshot (
            snapshot_date, rank, rank_fluctuation, character_name,
            class_code, job_code, level, exp, image_url,
            character_asset_key, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    with sqlite3.connect(primary_path) as conn:
        for row in legacy_rows:
            cursor = conn.execute(insert_sql, row)
            if cursor.rowcount > 0:
                merged += 1
        conn.commit()

    secondary_meta = get_app_meta(secondary_path, LAST_RANKING_FETCHED_AT_KEY)
    if secondary_meta:
        secondary_dt = parse_iso_datetime(secondary_meta)
        if secondary_dt:
            primary_meta = get_app_meta(primary_path, LAST_RANKING_FETCHED_AT_KEY)
            primary_dt = parse_iso_datetime(primary_meta) if primary_meta else None
            if primary_dt is None or secondary_dt > primary_dt:
                set_app_meta(
                    primary_path,
                    LAST_RANKING_FETCHED_AT_KEY,
                    secondary_dt.isoformat(timespec="seconds"),
                )

    reconcile_ranking_fetched_at_meta(primary_path)

    after = count_snapshot_dates(primary_path)

    if merged or after > before:
        logger.info(
            "Merged legacy ranking DB: inserted=%s snapshot_days %s->%s (%s -> %s)",
            merged,
            before,
            after,
            secondary_path,
            primary_path,
        )
    return merged
