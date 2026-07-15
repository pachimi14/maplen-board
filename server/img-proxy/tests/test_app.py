from __future__ import annotations

from pathlib import Path

from starlette.requests import Request

import app as img_proxy_app
from proxy_core import PNG_SIGNATURE


def _request(origin: str | None = None, raw_path: bytes = b"/") -> Request:
    headers = []
    if origin is not None:
        headers.append((b"origin", origin.encode("utf-8")))
    return Request({"type": "http", "method": "GET", "path": "/", "raw_path": raw_path, "headers": headers})


def _set_cache_dir(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("IMG_PROXY_CACHE_DIR", str(tmp_path))


def test_invalid_path_is_rejected_before_upstream(tmp_path: Path, monkeypatch) -> None:
    called = False

    def fail_if_called(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("upstream must not be called")

    monkeypatch.setattr(img_proxy_app, "_fetch_upstream_png", fail_if_called)
    _set_cache_dir(tmp_path, monkeypatch)
    response = img_proxy_app.proxy_charimage("../etc/passwd", _request())

    assert response.status_code == 400
    assert not called


def test_encoded_traversal_is_rejected_before_upstream(tmp_path: Path, monkeypatch) -> None:
    called = False

    def fail_if_called(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("upstream must not be called")

    monkeypatch.setattr(img_proxy_app, "_fetch_upstream_png", fail_if_called)
    _set_cache_dir(tmp_path, monkeypatch)
    response = img_proxy_app.proxy_charimage(
        "passwd.png",
        _request(raw_path=b"/img/charimages/transient/%2e%2e/passwd.png"),
    )

    assert response.status_code == 400
    assert not called


def test_upstream_failure_returns_placeholder_with_cors(tmp_path: Path, monkeypatch) -> None:
    def raise_failure(*args, **kwargs):
        raise img_proxy_app.UpstreamImageError("fixture failure")

    monkeypatch.setattr(img_proxy_app, "_fetch_upstream_png", raise_failure)
    _set_cache_dir(tmp_path, monkeypatch)
    response = img_proxy_app.proxy_charimage("transient/missing.png", _request("https://lulumi-tools.com"))

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://lulumi-tools.com"
    assert response.headers["x-img-fallback"] == "1"
    assert img_proxy_app.PLACEHOLDER_PATH.read_bytes().startswith(PNG_SIGNATURE)


def test_successful_fetch_is_cached_and_reused(tmp_path: Path, monkeypatch) -> None:
    calls = 0

    def fetch_fixture(*args, **kwargs):
        nonlocal calls
        calls += 1
        return PNG_SIGNATURE + b"fixture"

    monkeypatch.setattr(img_proxy_app, "_fetch_upstream_png", fetch_fixture)
    _set_cache_dir(tmp_path, monkeypatch)

    first = img_proxy_app.proxy_charimage("transient/example.png", _request())
    second = img_proxy_app.proxy_charimage("transient/example.png", _request())

    assert first.status_code == 200
    assert second.status_code == 200
    assert calls == 1

