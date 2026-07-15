from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from proxy_core import (
    PNG_SIGNATURE,
    cache_key_for_path,
    cache_path_for_key,
    cors_origin_for_request,
    is_cache_fresh,
    is_png_bytes,
    parse_allowed_origins,
    prune_cache,
    upstream_url_for_path,
    validate_charimage_path,
)


def test_validate_accepts_transient_png_path() -> None:
    path = "transient/abcDEF_012=-.png"
    assert validate_charimage_path(path) == path
    assert upstream_url_for_path(path).endswith("/charimages/transient/abcDEF_012=-.png")


@pytest.mark.parametrize(
    "path",
    [
        "../etc/passwd",
        "transient/../x.png",
        "transient/x.jpg",
        "transient/x.png?cache=1",
        "transient/x y.png",
        "transient\\x.png",
        "",
    ],
)
def test_validate_rejects_unsafe_paths(path: str) -> None:
    with pytest.raises(ValueError):
        validate_charimage_path(path)


def test_cache_key_is_sha256_of_clean_path() -> None:
    path = "transient/example.png"
    key = cache_key_for_path(path)
    assert len(key) == 64
    assert key == cache_key_for_path("/transient/example.png")
    assert cache_path_for_key(Path("/tmp/cache"), key).name == f"{key}.png"


def test_png_signature_check() -> None:
    assert is_png_bytes(PNG_SIGNATURE + b"rest")
    assert not is_png_bytes(b"<html>not an image</html>")


def test_cors_origin_defaults_to_production_and_echoes_allowed_origin() -> None:
    allowed = ("https://lulumi-tools.com", "http://127.0.0.1:9000")
    assert cors_origin_for_request(None, allowed) == "https://lulumi-tools.com"
    assert cors_origin_for_request("https://evil.example", allowed) == "https://lulumi-tools.com"
    assert cors_origin_for_request("http://127.0.0.1:9000", allowed) == "http://127.0.0.1:9000"


def test_parse_allowed_origins() -> None:
    assert parse_allowed_origins(None) == ("https://lulumi-tools.com",)
    assert parse_allowed_origins(" https://lulumi-tools.com/ , http://127.0.0.1:9000 ") == (
        "https://lulumi-tools.com",
        "http://127.0.0.1:9000",
    )


def test_cache_freshness(tmp_path: Path) -> None:
    cache_file = tmp_path / "x.png"
    cache_file.write_bytes(PNG_SIGNATURE)
    now = time.time()
    os.utime(cache_file, (now - 10, now - 10))
    assert is_cache_fresh(cache_file, now, 60)
    assert not is_cache_fresh(cache_file, now, 5)


def test_prune_cache_removes_old_files_only_until_under_limit(tmp_path: Path) -> None:
    old = tmp_path / "old.png"
    middle = tmp_path / "middle.png"
    keep = tmp_path / "keep.png"
    old.write_bytes(b"a" * 10)
    middle.write_bytes(b"b" * 10)
    keep.write_bytes(b"c" * 10)
    now = time.time()
    os.utime(old, (now - 30, now - 30))
    os.utime(middle, (now - 20, now - 20))
    os.utime(keep, (now - 10, now - 10))

    removed = prune_cache(tmp_path, 15, keep_path=keep)

    assert [path.name for path in removed] == ["old.png", "middle.png"]
    assert keep.exists()
