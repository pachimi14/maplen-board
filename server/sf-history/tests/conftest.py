from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


@pytest.fixture(autouse=True)
def _no_ambient_open_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """IMPL_PLAN_SH23 §2/§(f): tests must be offline and deterministic
    regardless of whatever is in the developer's shell environment (e.g. a
    real `MSU_OPEN_API_KEY` sourced from `raffle-api.env` for other work in
    this same shell). Every test starts with the key unset unless it
    explicitly sets one itself (always a synthetic, clearly-fake value)."""
    monkeypatch.delenv("MSU_OPEN_API_KEY", raising=False)
