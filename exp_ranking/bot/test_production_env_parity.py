"""Mechanical parity check: CI env block <-> production.env (IMPL_PLAN_local-daily-fetch §2.3).

No PyYAML: the workflow is parsed with a small line parser, fail-closed.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

BOT_DIR = Path(__file__).resolve().parent
REPO_ROOT = BOT_DIR.parent.parent
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "maplen-board-pages.yml"
PRODUCTION_ENV_PATH = BOT_DIR / "production.env"
DEV_ENV_PATH = BOT_DIR / ".env"

STEP_NAME = "Fetch ranking and export JSON"

# CI env keys deliberately NOT mirrored in production.env, with the reason.
EXCLUDED_KEYS = {
    "GH_TOKEN": "resolved at run time from `gh auth token`",
    "GH_REPO": "resolved at run time from `gh repo view`",
    "SKIP_MSU_RANKING_FETCH": "driven by commit message [web-only]; PC never sets it",
    "FORCE_RANKING_FETCH": "driver decides (never force; day-exists skip stays on)",
    "ENFORCE_JST_FETCH_WINDOW": "driver decides from the clock (event-driven in CI)",
    "SKIP_DEPLOY_IF_DAY_CAPTURED": "CI deploy gate only; irrelevant to the PC run",
}
EXCLUDED_PREFIXES = ("SNAPSHOT_GUARD_",)  # diagnostic-only inputs of snapshot_guard


def is_excluded(key: str, value: str) -> bool:
    return (
        key in EXCLUDED_KEYS
        or key.startswith(EXCLUDED_PREFIXES)
        or "${{" in value
    )


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def parse_ci_env(workflow_text: str, step_name: str = STEP_NAME) -> dict[str, str]:
    """Extract the ``env:`` mapping of the named step. Raises ValueError if not found."""
    lines = workflow_text.splitlines()
    step_re = re.compile(r"^(\s*)-\s+name:\s*(.+?)\s*$")
    start = None
    for i, line in enumerate(lines):
        m = step_re.match(line)
        if m and m.group(2).strip("\"'") == step_name:
            start = i
            step_indent = len(m.group(1))
            break
    if start is None:
        raise ValueError(f"step not found: {step_name!r}")

    env_idx = None
    env_indent = 0
    for j in range(start + 1, len(lines)):
        line = lines[j]
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip())
        if indent <= step_indent and line.lstrip().startswith("- "):
            break  # next step began
        if line.strip() == "env:":
            env_idx = j
            env_indent = indent
            break
    if env_idx is None:
        raise ValueError(f"env: block not found in step {step_name!r}")

    result: dict[str, str] = {}
    for line in lines[env_idx + 1 :]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        if indent <= env_indent:
            break
        m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$", line)
        if not m:
            raise ValueError(f"unparseable env line: {line!r}")
        raw = m.group(2)
        # strip a trailing comment only for unquoted scalars
        if raw[:1] not in "\"'" and " #" in raw:
            raw = raw.split(" #", 1)[0]
        result[m.group(1)] = _unquote(raw)
    if not result:
        raise ValueError("env: block is empty")
    return result


def parse_env_file(text: str) -> dict[str, str]:
    """Same semantics as config.load_env_file()."""
    result: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            result[key] = value
    return result


def find_parity_errors(ci_env: dict[str, str], prod_env: dict[str, str]) -> list[str]:
    errors: list[str] = []
    for key, ci_value in sorted(ci_env.items()):
        if is_excluded(key, ci_value):
            continue
        if key not in prod_env:
            errors.append(f"CI key {key!r} is neither in production.env nor in the exclusion list")
        elif prod_env[key] != ci_value:
            errors.append(f"{key}: CI={ci_value!r} production.env={prod_env[key]!r}")
    return errors


def find_dev_env_conflicts(prod_env: dict[str, str], dev_env: dict[str, str]) -> list[str]:
    return [
        f"{key}: production.env={value!r} .env={dev_env[key]!r}"
        for key, value in sorted(prod_env.items())
        if key in dev_env and dev_env[key] != value
    ]


@pytest.fixture(scope="module")
def ci_env() -> dict[str, str]:
    return parse_ci_env(WORKFLOW_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def prod_env() -> dict[str, str]:
    return parse_env_file(PRODUCTION_ENV_PATH.read_text(encoding="utf-8"))


def test_ci_env_matches_production_env(ci_env, prod_env):
    assert find_parity_errors(ci_env, prod_env) == []


def test_ci_env_block_is_found_and_nonempty(ci_env):
    # sanity: the parser really saw the block (fail-closed against a silent empty parse)
    assert "RANKING_MIN_LEVEL" in ci_env and len(ci_env) >= 15


def test_production_env_has_no_secrets(prod_env):
    for key in prod_env:
        assert not any(w in key for w in ("TOKEN", "SECRET", "PASSWORD")), key


def test_dev_env_does_not_override_production_env(prod_env):
    dev = parse_env_file(DEV_ENV_PATH.read_text(encoding="utf-8")) if DEV_ENV_PATH.exists() else {}
    assert find_dev_env_conflicts(prod_env, dev) == []


# --- negative cases: the check must actually detect divergence ---------------
# Built from a synthetic baseline so they stay meaningful even when the real
# production.env is the thing that is broken.


def _baseline(ci_env):
    return {k: v for k, v in ci_env.items() if not is_excluded(k, v)}


def test_baseline_is_clean(ci_env):
    assert find_parity_errors(ci_env, _baseline(ci_env)) == []


def test_detects_changed_ci_value(ci_env):
    mutated = dict(ci_env)
    mutated["RANKING_MAX_PAGES"] = "800"
    errors = find_parity_errors(mutated, _baseline(ci_env))
    assert len(errors) == 1 and "RANKING_MAX_PAGES" in errors[0]


def test_detects_new_unlisted_ci_key(ci_env):
    mutated = dict(ci_env)
    mutated["BRAND_NEW_KEY"] = "1"
    errors = find_parity_errors(mutated, _baseline(ci_env))
    assert len(errors) == 1 and "BRAND_NEW_KEY" in errors[0]


def test_detects_dev_env_conflict(ci_env):
    base = _baseline(ci_env)
    assert len(find_dev_env_conflicts(base, {"RANKING_MAX_PAGES": "800"})) == 1
    assert find_dev_env_conflicts(base, {"RANKING_MAX_PAGES": base["RANKING_MAX_PAGES"]}) == []


def test_parser_fails_closed_when_block_missing():
    no_step = "jobs:" + chr(10) + "  b:" + chr(10) + "      - name: Other" + chr(10) + "        run: x" + chr(10)
    no_env = "steps:" + chr(10) + "  - name: Fetch ranking and export JSON" + chr(10) + "    run: x" + chr(10)
    with pytest.raises(ValueError):
        parse_ci_env(no_step)
    with pytest.raises(ValueError):
        parse_ci_env(no_env)
