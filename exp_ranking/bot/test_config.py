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