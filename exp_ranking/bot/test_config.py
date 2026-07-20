import config


def test_navigator_export_rankings_json_defaults_enabled(monkeypatch):
    monkeypatch.delenv("NAVIGATOR_EXPORT_RANKINGS_JSON", raising=False)

    assert config.navigator_export_rankings_json() is True


def test_navigator_export_rankings_json_false_values(monkeypatch):
    for value in ("0", "false", "no", "off", "FALSE", " Off "):
        monkeypatch.setenv("NAVIGATOR_EXPORT_RANKINGS_JSON", value)

        assert config.navigator_export_rankings_json() is False


def test_navigator_export_rankings_json_true_values(monkeypatch):
    for value in ("1", "true", "yes", "on", "unexpected"):
        monkeypatch.setenv("NAVIGATOR_EXPORT_RANKINGS_JSON", value)

        assert config.navigator_export_rankings_json() is True


def test_snapshot_import_from_v2_shards_defaults_disabled(monkeypatch):
    monkeypatch.delenv("SNAPSHOT_IMPORT_FROM_V2_SHARDS", raising=False)

    assert config.snapshot_import_from_v2_shards() is False


def test_snapshot_import_from_v2_shards_true_values(monkeypatch):
    for value in ("1", "true", "yes", "on"):
        monkeypatch.setenv("SNAPSHOT_IMPORT_FROM_V2_SHARDS", value)

        assert config.snapshot_import_from_v2_shards() is True


def test_snapshot_import_from_v2_shards_false_values(monkeypatch):
    for value in ("0", "false", "no", "off", "unexpected", ""):
        monkeypatch.setenv("SNAPSHOT_IMPORT_FROM_V2_SHARDS", value)

        assert config.snapshot_import_from_v2_shards() is False


def test_pages_v2_rankings_url_default(monkeypatch):
    monkeypatch.delenv("MVP_PAGES_V2_RANKINGS_URL", raising=False)
    monkeypatch.delenv("PAGES_SITE_URL", raising=False)

    assert config.pages_v2_rankings_url() == "https://lulumi-tools.com/data/v2/rankings.json"


def test_pages_v2_rankings_url_env_override(monkeypatch):
    monkeypatch.setenv("MVP_PAGES_V2_RANKINGS_URL", "https://example.test/data/v2/rankings.json")

    assert config.pages_v2_rankings_url() == "https://example.test/data/v2/rankings.json"