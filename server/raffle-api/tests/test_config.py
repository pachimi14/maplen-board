from __future__ import annotations

from pathlib import Path

from config import load_settings


def test_item_cache_defaults_to_the_os_user_cache(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("RAFFLE_API_ITEM_CACHE_DB", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))

    settings = load_settings()

    assert Path(settings.item_cache_db_path) == (tmp_path / "lulumi-tools" / "raffle-item-metadata.sqlite3").absolute()
    assert settings.item_cache_ttl_seconds == 30 * 24 * 60 * 60


def test_item_cache_can_be_disabled_and_ttl_is_bounded(monkeypatch) -> None:
    monkeypatch.setenv("RAFFLE_API_ITEM_CACHE_DB", "off")
    monkeypatch.setenv("RAFFLE_API_ITEM_CACHE_TTL_DAYS", "999")

    settings = load_settings()

    assert settings.item_cache_db_path is None
    assert settings.item_cache_ttl_seconds == 90 * 24 * 60 * 60