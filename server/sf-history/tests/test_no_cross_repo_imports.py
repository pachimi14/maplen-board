"""★2026-08-15 VPS fix (統括 検収差し戻し): `server/sf-history/` is deployed
to the VPS entirely on its own -- `/home/botuser/apps/lulumi-tools-sf-
history/` never has a maplenEnhancebot checkout alongside it.
`scripts/scan_discovery.py` used to `import item_catalog` from there for
`pick_representative_item` and crashed on the VPS with `ModuleNotFoundError`
the instant `sf-history-discovery-scan.service` ran. `discovery.py` now
carries its own `pick_representative_item` (the same rule, re-implemented,
not imported -- see that function's own docstring).

This module is the regression guard for that class of bug, for every
DISCOVERY runtime module (plan §5(u)): `db.py` / `discovery.py` / `app.py`
are already exercised offline by every other test in this directory (their
own imports would already fail loudly if they reached for maplenEnhancebot),
but `scripts/scan_discovery.py` and `scripts/poll_discovery.py` are only
ever imported by their own dedicated test files, which run in THIS
developer machine's environment -- where maplenEnhancebot happens to sit
right next to this repo (`C:\\Users\\pachi\\Desktop\\maplenEnhancebot`,
`scripts/gen_item_list.py`'s own `DEFAULT_SOURCE_REPO`), which is exactly
why the old bug passed every local test and only broke on the VPS.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT / "scripts"

# module name -> the file that defines it (top-level module, not a package).
MODULE_PATHS = {
    "db": ROOT / "db.py",
    "discovery": ROOT / "discovery.py",
    "app": ROOT / "app.py",
    "scan_discovery": SCRIPTS_DIR / "scan_discovery.py",
    "poll_discovery": SCRIPTS_DIR / "poll_discovery.py",
}


@pytest.mark.parametrize("module_name", sorted(MODULE_PATHS))
def test_module_imports_with_a_sys_path_that_excludes_maplenenhancebot(module_name: str) -> None:
    """(u): spawns a FRESH subprocess whose `sys.path` contains only this
    repo's `server/sf-history/` tree (plus the interpreter's own stdlib/
    site-packages) -- if the module still reached for maplenEnhancebot, this
    fails with `ModuleNotFoundError`, exactly like the VPS did. `PYTHONPATH`
    is deliberately dropped from the subprocess's environment so nothing in
    this developer machine's shell (e.g. a `PYTHONPATH` pointing at
    maplenEnhancebot, set for unrelated work) can mask the bug this test
    exists to catch.
    """
    code = (
        "import sys; "
        f"sys.path[:0] = [{str(ROOT)!r}, {str(SCRIPTS_DIR)!r}]; "
        f"import {module_name}"
    )
    env = {key: value for key, value in os.environ.items() if key != "PYTHONPATH"}
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        cwd=str(ROOT),
        env=env,
        timeout=30,
    )
    assert result.returncode == 0, (
        f"{module_name} failed to import with maplenEnhancebot excluded from sys.path "
        f"(this is exactly the VPS failure mode):\n{result.stderr}"
    )


# Precise regex for an actual `import`/`from ... import` statement -- NOT a
# blind substring search for "maplenEnhancebot" (several files' comments
# legitimately document *why* there is no such import anymore, and a naive
# substring check would flag that prose as a violation).
_FORBIDDEN_IMPORT_PATTERN = re.compile(r"^\s*(import|from)\s+(item_catalog|priority_equipment)\b", re.MULTILINE)


@pytest.mark.parametrize("module_name", sorted(MODULE_PATHS))
def test_module_source_has_no_maplenenhancebot_import_statement(module_name: str) -> None:
    """Static companion to the subprocess check above -- fails fast with a
    precise line match instead of a subprocess traceback if this class of
    bug is ever reintroduced."""
    source = MODULE_PATHS[module_name].read_text(encoding="utf-8")
    match = _FORBIDDEN_IMPORT_PATTERN.search(source)
    assert match is None, f"{module_name}.py has a maplenEnhancebot import statement: {match.group(0)!r}"
