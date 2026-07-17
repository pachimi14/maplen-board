from __future__ import annotations

import hashlib
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path


UPSTREAM_BASE_URL = "https://market-static.msu.io/msu/platform/charimages"
DEFAULT_ALLOWED_ORIGINS = ("https://lulumi-tools.com",)
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

_PATH_PATTERN = re.compile(r"^(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9=_-]+\.png$")


@dataclass(frozen=True)
class ProxySettings:
    allowed_origins: tuple[str, ...] = DEFAULT_ALLOWED_ORIGINS
    cache_ttl_seconds: int = 7 * 24 * 60 * 60
    cache_max_bytes: int = 500 * 1024 * 1024
    max_upstream_bytes: int = 1 * 1024 * 1024
    upstream_timeout_seconds: float = 5.0


def parse_allowed_origins(raw: str | None) -> tuple[str, ...]:
    if not raw:
        return DEFAULT_ALLOWED_ORIGINS
    origins = tuple(origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip())
    return origins or DEFAULT_ALLOWED_ORIGINS


def load_settings_from_env() -> ProxySettings:
    return ProxySettings(
        allowed_origins=parse_allowed_origins(os.getenv("IMG_PROXY_ALLOWED_ORIGINS")),
        cache_ttl_seconds=_positive_int_env("IMG_PROXY_CACHE_TTL_SECONDS", 7 * 24 * 60 * 60),
        cache_max_bytes=_positive_int_env("IMG_PROXY_CACHE_MAX_BYTES", 500 * 1024 * 1024),
        max_upstream_bytes=_positive_int_env("IMG_PROXY_MAX_UPSTREAM_BYTES", 1 * 1024 * 1024),
        upstream_timeout_seconds=_positive_float_env("IMG_PROXY_UPSTREAM_TIMEOUT_SECONDS", 5.0),
    )


def _positive_int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _positive_float_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def validate_charimage_path(raw_path: str) -> str:
    path = raw_path.strip().lstrip("/")
    if len(path) > 512:
        raise ValueError("path is too long")
    if not path:
        raise ValueError("path is required")
    if "\\" in path or ".." in path:
        raise ValueError("path traversal is not allowed")
    if not _PATH_PATTERN.fullmatch(path):
        raise ValueError("path contains unsupported characters or extension")
    return path


def upstream_url_for_path(path: str) -> str:
    clean_path = validate_charimage_path(path)
    return f"{UPSTREAM_BASE_URL}/{clean_path}"


def cache_key_for_path(path: str) -> str:
    clean_path = validate_charimage_path(path)
    return hashlib.sha256(clean_path.encode("utf-8")).hexdigest()


def cache_path_for_key(cache_dir: Path, cache_key: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{64}", cache_key):
        raise ValueError("invalid cache key")
    return cache_dir / f"{cache_key}.png"


def is_png_bytes(data: bytes) -> bool:
    return data.startswith(PNG_SIGNATURE)


def cors_origin_for_request(request_origin: str | None, allowed_origins: tuple[str, ...]) -> str:
    if request_origin:
        normalized_origin = request_origin.rstrip("/")
        if normalized_origin in allowed_origins:
            return normalized_origin
    return allowed_origins[0]


def is_cache_fresh(path: Path, now: float, ttl_seconds: int) -> bool:
    if not path.exists():
        return False
    if path.stat().st_size <= 0:
        return False
    return now - path.stat().st_mtime <= ttl_seconds


def prune_cache(cache_dir: Path, max_bytes: int, keep_path: Path | None = None) -> list[Path]:
    if max_bytes <= 0 or not cache_dir.exists():
        return []
    files = sorted(
        (path for path in cache_dir.glob("*.png") if path.is_file()),
        key=lambda path: path.stat().st_mtime,
    )
    total = sum(path.stat().st_size for path in files)
    removed: list[Path] = []
    keep_resolved = keep_path.resolve() if keep_path is not None and keep_path.exists() else None
    for path in files:
        if total <= max_bytes:
            break
        if keep_resolved is not None and path.resolve() == keep_resolved:
            continue
        size = path.stat().st_size
        path.unlink()
        removed.append(path)
        total -= size
    return removed
