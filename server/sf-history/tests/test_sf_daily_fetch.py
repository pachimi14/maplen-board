from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_PATH = Path(__file__).resolve().parents[1] / "ops" / "sf_daily_fetch.py"
_spec = importlib.util.spec_from_file_location("sf_daily_fetch", _PATH)
sf_daily_fetch = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sf_daily_fetch)

OK_LINE = '{"insertedSf":3,"insertedCube":1,"combosTouched":2,"maxPriceAt":"2026-11-25T07:00:00Z","integrity":"ok"}'


def test_parse_ingest_result_accepts_last_json_line() -> None:
    result = sf_daily_fetch.parse_ingest_result("noise\n" + OK_LINE + "\n")
    assert result["insertedSf"] == 3 and result["integrity"] == "ok"


@pytest.mark.parametrize(
    "text",
    ["", "not json\n", '{"insertedSf":1}\n', OK_LINE.replace('"ok"', '"FAILED"')],
)
def test_parse_ingest_result_fails_closed(text: str) -> None:
    with pytest.raises(sf_daily_fetch.SfDailyFetchError):
        sf_daily_fetch.parse_ingest_result(text)


def test_ssh_command_uses_dedicated_key_and_no_remote_command() -> None:
    cmd = sf_daily_fetch.build_ssh_command("K", "botuser@h")
    assert cmd[:3] == ["ssh", "-i", "K"] and cmd[-1] == "botuser@h"
    assert "BatchMode=yes" in cmd and "IdentitiesOnly=yes" in cmd
