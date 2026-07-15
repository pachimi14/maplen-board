from __future__ import annotations

import os
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response

from proxy_core import (
    ProxySettings,
    cache_key_for_path,
    cache_path_for_key,
    cors_origin_for_request,
    is_cache_fresh,
    is_png_bytes,
    load_settings_from_env,
    prune_cache,
    upstream_url_for_path,
    validate_charimage_path,
)


APP_DIR = Path(__file__).resolve().parent
DEFAULT_CACHE_DIR = APP_DIR / ".cache"
PLACEHOLDER_PATH = APP_DIR / "assets" / "placeholder.png"

app = FastAPI(title="Lulumi Tools image proxy", docs_url=None, redoc_url=None)


class UpstreamImageError(Exception):
    pass


def _settings() -> ProxySettings:
    return load_settings_from_env()


def _cache_dir() -> Path:
    return Path(os.getenv("IMG_PROXY_CACHE_DIR", str(DEFAULT_CACHE_DIR))).resolve()


def _cors_headers(request: Request, settings: ProxySettings, *, fallback: bool = False) -> dict[str, str]:
    headers = {
        "Access-Control-Allow-Origin": cors_origin_for_request(request.headers.get("origin"), settings.allowed_origins),
        "Vary": "Origin",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
    }
    if fallback:
        headers["X-Img-Fallback"] = "1"
    return headers


def _fetch_upstream_png(path: str, settings: ProxySettings) -> bytes:
    request = urllib.request.Request(
        upstream_url_for_path(path),
        headers={"User-Agent": "lulumi-tools-img-proxy/1.0"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=settings.upstream_timeout_seconds) as response:
            status = getattr(response, "status", 0)
            if status != 200:
                raise UpstreamImageError(f"upstream status {status}")
            content_type = response.headers.get("Content-Type", "")
            if "image/png" not in content_type.lower():
                raise UpstreamImageError(f"unexpected content type {content_type}")
            chunks: list[bytes] = []
            total = 0
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > settings.max_upstream_bytes:
                    raise UpstreamImageError("upstream image is too large")
                chunks.append(chunk)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
        raise UpstreamImageError(str(exc)) from exc

    data = b"".join(chunks)
    if not data or not is_png_bytes(data):
        raise UpstreamImageError("upstream body is not a PNG")
    return data


def _write_cache_atomically(cache_file: Path, data: bytes) -> None:
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".tmp-img-", suffix=".png", dir=cache_file.parent)
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as file:
            file.write(data)
        os.replace(tmp_path, cache_file)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()


def _request_has_encoded_dot(request: Request) -> bool:
    raw_path = request.scope.get("raw_path", b"")
    if isinstance(raw_path, bytes):
        return b"%2e" in raw_path.lower()
    return "%2e" in str(raw_path).lower()


def _placeholder_response(request: Request, settings: ProxySettings) -> FileResponse:
    return FileResponse(
        PLACEHOLDER_PATH,
        media_type="image/png",
        headers=_cors_headers(request, settings, fallback=True),
    )


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.head("/img/charimages/{path:path}")
@app.get("/img/charimages/{path:path}")
def proxy_charimage(path: str, request: Request) -> Response:
    settings = _settings()
    if _request_has_encoded_dot(request):
        return Response("encoded traversal is not allowed", status_code=400, media_type="text/plain")

    try:
        clean_path = validate_charimage_path(path)
    except ValueError as exc:
        return Response(str(exc), status_code=400, media_type="text/plain")

    cache_dir = _cache_dir()
    cache_file = cache_path_for_key(cache_dir, cache_key_for_path(clean_path))
    now = request.scope.get("_img_proxy_now")
    if now is None:
        import time

        now = time.time()

    if is_cache_fresh(cache_file, float(now), settings.cache_ttl_seconds) and is_png_bytes(cache_file.read_bytes()):
        return FileResponse(
            cache_file,
            media_type="image/png",
            headers=_cors_headers(request, settings),
        )

    try:
        data = _fetch_upstream_png(clean_path, settings)
    except UpstreamImageError:
        return _placeholder_response(request, settings)

    _write_cache_atomically(cache_file, data)
    prune_cache(cache_dir, settings.cache_max_bytes, keep_path=cache_file)
    return FileResponse(
        cache_file,
        media_type="image/png",
        headers=_cors_headers(request, settings),
    )
