from __future__ import annotations

import os
from dataclasses import dataclass


DEFAULT_ALLOWED_ORIGINS = ("https://lulumi-tools.com",)


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if value > 0 else default


def _allowed_origins(raw: str | None) -> tuple[str, ...]:
    if not raw:
        return DEFAULT_ALLOWED_ORIGINS
    values = tuple(value.strip().rstrip("/") for value in raw.split(",") if value.strip())
    return values or DEFAULT_ALLOWED_ORIGINS

def _item_cache_db_path(raw: str | None) -> str | None:
    value = (raw or "").strip()
    if value.casefold() in {"off", "disabled", "none"}:
        return None
    if value:
        return os.path.abspath(os.path.expanduser(value))
    local_app_data = os.getenv("LOCALAPPDATA", "").strip()
    if local_app_data:
        base = local_app_data
    else:
        base = os.getenv("XDG_CACHE_HOME", "").strip() or os.path.join(os.path.expanduser("~"), ".cache")
    return os.path.abspath(os.path.join(base, "lulumi-tools", "raffle-item-metadata.sqlite3"))


@dataclass(frozen=True)
class Settings:
    allowed_origins: tuple[str, ...]
    fixture_mode: bool
    queue_capacity: int
    completed_capacity: int
    job_ttl_seconds: int
    upstream_start_interval_ms: int
    hard_timeout_seconds: int
    daily_upstream_budget: int
    fixture_delay_ms: int
    item_cache_db_path: str | None
    item_cache_ttl_seconds: int


def load_settings() -> Settings:
    return Settings(
        allowed_origins=_allowed_origins(os.getenv("RAFFLE_API_ALLOWED_ORIGINS")),
        fixture_mode=os.getenv("RAFFLE_API_FIXTURE_MODE", "").strip() == "1",
        queue_capacity=min(_positive_int("RAFFLE_API_QUEUE_CAPACITY", 20), 100),
        completed_capacity=min(_positive_int("RAFFLE_API_COMPLETED_CAPACITY", 50), 200),
        job_ttl_seconds=min(_positive_int("RAFFLE_API_JOB_TTL_SECONDS", 300), 3600),
        upstream_start_interval_ms=max(_positive_int("RAFFLE_API_UPSTREAM_INTERVAL_MS", 1000), 1000),
        hard_timeout_seconds=min(_positive_int("RAFFLE_API_HARD_TIMEOUT_SECONDS", 45), 60),
        daily_upstream_budget=min(_positive_int("RAFFLE_API_DAILY_BUDGET", 2700), 3000),
        fixture_delay_ms=min(_positive_int("RAFFLE_API_FIXTURE_DELAY_MS", 10), 1000),
        item_cache_db_path=_item_cache_db_path(os.getenv("RAFFLE_API_ITEM_CACHE_DB")),
        item_cache_ttl_seconds=min(_positive_int("RAFFLE_API_ITEM_CACHE_TTL_DAYS", 30), 90) * 24 * 60 * 60,
    )