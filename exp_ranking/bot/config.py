"""Environment configuration for MapleN Board ranking bot."""

from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"

DEFAULT_RANKING_MIN_LEVEL = 225
DEFAULT_RANKING_MAX_PAGES = 800
DEFAULT_SNAPSHOT_RETENTION_DAYS = 35
DEFAULT_MVP_HISTORY_DAYS = 35


def load_env_file(env_path: Path = ENV_PATH) -> None:
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ[key] = value


def env_path(name: str, default: str = "") -> Path:
    raw = os.environ.get(name, default).strip()
    path = Path(raw)
    if not path.is_absolute():
        path = BASE_DIR / path
    return path


def ranking_min_level() -> int:
    return max(1, int(os.environ.get("RANKING_MIN_LEVEL", str(DEFAULT_RANKING_MIN_LEVEL))))


def ranking_max_pages() -> int:
    return max(1, int(os.environ.get("RANKING_MAX_PAGES", str(DEFAULT_RANKING_MAX_PAGES))))


def ranking_request_delay_sec() -> float:
    return max(0.0, float(os.environ.get("RANKING_REQUEST_DELAY_SEC", "0.35")))


def navigator_request_delay_sec() -> float:
    return max(0.0, float(os.environ.get("NAVIGATOR_REQUEST_DELAY_SEC", "0.35")))


def navigator_fetch_enabled() -> bool:
    raw = os.environ.get("NAVIGATOR_FETCH_ENABLED", "true").strip().lower()
    return raw not in ("0", "false", "no", "off")


def sqlite_db_path() -> Path:
    default = str(BASE_DIR / "data" / "ranking.db")
    return env_path("SQLITE_DB_PATH", default)


def snapshot_retention_days() -> int:
    return max(1, int(os.environ.get("SNAPSHOT_RETENTION_DAYS", str(DEFAULT_SNAPSHOT_RETENTION_DAYS))))


def mvp_history_days() -> int | None:
    raw = os.environ.get("MVP_HISTORY_DAYS", str(DEFAULT_MVP_HISTORY_DAYS)).strip()
    if not raw or raw == "0":
        return None
    return max(1, int(raw))


def mvp_export_top_n() -> int | None:
    raw = os.environ.get("MVP_EXPORT_TOP_N", "0").strip()
    if not raw or raw == "0":
        return None
    return max(1, int(raw))


def benchmark_character_name() -> str:
    return os.environ.get("BENCHMARK_CHARACTER_NAME", "pachimi").strip()


def mvp_json_output_path() -> Path:
    default = str(BASE_DIR.parent / "web" / "public" / "data" / "rankings.json")
    return env_path("MVP_JSON_OUTPUT_PATH", default)


def character_meta_json_path() -> Path:
    default = str(BASE_DIR / "data" / "character_meta.json")
    return env_path("CHARACTER_META_JSON_PATH", default)


def pages_rankings_url() -> str:
    return os.environ.get(
        "MVP_PAGES_RANKINGS_URL",
        "https://pachimi14.github.io/maplen-board/data/rankings.json",
    ).strip()


def hydrate_meta_from_pages() -> bool:
    raw = os.environ.get("HYDRATE_META_FROM_PAGES", "true").strip().lower()
    return raw not in ("0", "false", "no", "off")


def snapshot_import_from_pages() -> bool:
    """Backfill SQLite from production rankings.json when DB lacks history days."""
    raw = os.environ.get("SNAPSHOT_IMPORT_FROM_PAGES", "true").strip().lower()
    return raw not in ("0", "false", "no", "off")


def snapshot_seed_json_path() -> Path:
    default = str(BASE_DIR / "data" / "seed" / "rankings_seed.json")
    return env_path("IMPORT_SNAPSHOTS_JSON", default)


def should_import_snapshot_seed(db_path: Path, seed_path: Path) -> bool:
    from sqlite_storage import count_snapshot_dates, list_snapshot_dates, snapshot_dates_in_mvp_json

    if not seed_path.exists():
        return False

    seed_dates = snapshot_dates_in_mvp_json(seed_path)
    if not seed_dates:
        return False

    db_dates = set(list_snapshot_dates(db_path))
    missing = seed_dates - db_dates
    if missing:
        return True

    return count_snapshot_dates(db_path) < len(seed_dates)


def enforce_jst_fetch_window() -> bool:
    raw = os.environ.get("ENFORCE_JST_FETCH_WINDOW", "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def force_ranking_fetch() -> bool:
    """When true, always fetch ranking API + Navigator even if today is in DB."""
    raw = os.environ.get("FORCE_RANKING_FETCH", "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def skip_fetch_if_ranking_day_exists() -> bool:
    """Alias of skip_run_if_ranking_day_exists (ranking + navigator are skipped together)."""
    return skip_run_if_ranking_day_exists()


def skip_run_if_ranking_day_exists() -> bool:
    """Skip ranking API and Navigator when today's snapshot is already stored."""
    if force_ranking_fetch():
        return False
    raw = os.environ.get("SKIP_RUN_IF_RANKING_DAY_EXISTS", "true").strip().lower()
    return raw not in ("0", "false", "no", "off")


def skip_deploy_if_day_captured() -> bool:
    """When fetch is skipped, also skip CI deploy (export-only on push sets false)."""
    raw = os.environ.get("SKIP_DEPLOY_IF_DAY_CAPTURED", "true").strip().lower()
    return raw not in ("0", "false", "no", "off")


def skip_run_min_snapshot_rows() -> int:
    raw = os.environ.get("SKIP_RUN_MIN_SNAPSHOT_ROWS", "1000").strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 1000


def ranking_day_skip_marker_path() -> Path:
    return BASE_DIR / "data" / ".ranking_day_complete"


def resolve_snapshot_import_path(db_path: Path) -> Path | None:
    """Pick a rankings.json seed when DB is missing snapshot days from that file."""
    candidates: list[Path] = [snapshot_seed_json_path()]

    local_json = BASE_DIR.parent / "web" / "public" / "data" / "rankings.json"
    if local_json not in candidates:
        candidates.append(local_json)

    for path in candidates:
        if path.exists() and should_import_snapshot_seed(db_path, path):
            return path
    return None


def _read_snapshot_days(json_path: Path) -> int | None:
    import json

    try:
        payload = json.loads(json_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    meta = payload.get("meta")
    if not isinstance(meta, dict):
        return None
    days = meta.get("snapshotDays")
    return int(days) if days is not None else None
