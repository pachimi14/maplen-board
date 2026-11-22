"""Home-PC daily fetch driver (IMPL_PLAN_local-daily-fetch).

preflight -> already-published check -> Release download -> main.py ->
fail-closed gates -> Release merge-write -> workflow dispatch -> publish check.

No new rules are implemented here: ranking day comes from main.snapshot_date_ranking,
Release I/O from release_store, fetching from main.py (unchanged, run as a subprocess).

Usage:  python daily_fetch.py [--dry-run]
  --dry-run: preflight + published check + plan only. No official-API request,
             no Release download/write, no workflow dispatch.
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

BOT_DIR = Path(__file__).resolve().parent
REPO_ROOT = BOT_DIR.parent.parent
PRODUCTION_ENV_PATH = BOT_DIR / "production.env"
LOG_DIR = BOT_DIR / "logs"
WORKFLOW_FILE = "maplen-board-pages.yml"
SITE_RANKINGS_URL = "https://lulumi-tools.com/data/v2/rankings.json"

JST = timezone(timedelta(hours=9))

MIN_FREE_GB = 5
G3_MIN_ROWS = 10_000  # published population is ~10,601
WAIT_WINDOW_START = (9, 0)  # JST: poll for the official update only near the reset
WAIT_WINDOW_END = (9, 45)
DISPATCH_MAX_RETRIES = 2
DISPATCH_RETRY_INTERVAL_SEC = 60
RUN_WAIT_TIMEOUT_SEC = 90 * 60
SITE_WAIT_TIMEOUT_SEC = 15 * 60
POLL_SEC = 30

logger = logging.getLogger("daily_fetch")


class DailyFetchError(RuntimeError):
    pass


# --------------------------------------------------------------------------
# pure helpers (unit-tested)
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class GateInput:
    main_rc: int
    expected_day: str
    latest_day: str | None
    expected_day_rows: int
    days_before: int
    days_after: int


def evaluate_gates(g: GateInput) -> list[str]:
    """Return the list of violated gates (empty = OK to write to Release). G1..G4 of plan §2.4."""
    failed: list[str] = []
    if g.main_rc != 0:
        failed.append(f"G1 main.py exit code {g.main_rc} != 0")
    if g.latest_day != g.expected_day:
        failed.append(f"G2 latest ranking_day {g.latest_day!r} != expected {g.expected_day!r}")
    if g.expected_day_rows < G3_MIN_ROWS:
        failed.append(f"G3 rows for {g.expected_day} = {g.expected_day_rows} < {G3_MIN_ROWS}")
    if g.days_after < g.days_before:
        failed.append(f"G4 snapshot days decreased {g.days_before} -> {g.days_after}")
    return failed


_LATEST_RE = re.compile(r'"latestSnapshotDate"\s*:\s*"(\d{4}-\d{2}-\d{2})"')


def extract_latest_snapshot_date(head_text: str) -> str | None:
    m = _LATEST_RE.search(head_text)
    return m.group(1) if m else None


def should_wait_for_update(now_jst: datetime) -> bool:
    """Poll for the official rebuild only in the minutes around the 09:00 JST reset."""
    hm = (now_jst.hour, now_jst.minute)
    return WAIT_WINDOW_START <= hm < WAIT_WINDOW_END


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


def desktop_dir() -> Path:
    return Path(os.environ.get("USERPROFILE") or Path.home()) / "Desktop"


def marker_path(expected_day: str) -> Path:
    return desktop_dir() / f"LULUMI_FETCH_FAILED_{expected_day}.txt"


def write_failure_marker(expected_day: str, reason: str, log_path: Path) -> Path:
    path = marker_path(expected_day)
    path.parent.mkdir(parents=True, exist_ok=True)
    one_line = " ".join(reason.split())[:300]
    path.write_text(f"{one_line}\nlog: {log_path}\n", encoding="utf-8")
    return path


def clear_failure_marker(expected_day: str) -> None:
    try:
        marker_path(expected_day).unlink()
    except FileNotFoundError:
        pass


# --------------------------------------------------------------------------
# side-effecting steps
# --------------------------------------------------------------------------


def run_cmd(args: list[str], *, cwd: Path = BOT_DIR, check: bool = True, env: dict | None = None):
    proc = subprocess.run(
        args, cwd=cwd, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if check and proc.returncode != 0:
        raise DailyFetchError(
            f"command failed rc={proc.returncode}: {' '.join(args)}\n{(proc.stderr or proc.stdout).strip()[:500]}"
        )
    return proc


def preflight() -> dict[str, str]:
    """Plan §2.3. Returns the resolved base environment extras (GH_TOKEN/GH_REPO)."""
    # 1. CI <-> production.env parity (+ .env conflict). Mechanical, not by eye.
    proc = run_cmd(
        [sys.executable, "-m", "pytest", "test_production_env_parity.py", "-q", "-p", "no:cacheprovider"],
        check=False,
    )
    if proc.returncode != 0:
        logger.error("parity test output:\n%s", (proc.stdout or proc.stderr).strip()[-2000:])
        raise DailyFetchError("env parity test failed (CI env and production.env diverge, or .env conflicts)")
    logger.info("preflight: env parity test OK")

    # 2. gh auth + scopes
    auth = run_cmd(["gh", "auth", "status"], check=False)
    text = (auth.stdout or "") + (auth.stderr or "")
    if auth.returncode != 0:
        raise DailyFetchError(f"gh auth status failed: {text.strip()[:300]}")
    scopes = re.findall(r"Token scopes:(.*)", text)
    scope_set = set(re.findall(r"[A-Za-z_:]+", scopes[0])) if scopes else set()
    for needed in ("repo", "workflow"):
        if needed not in scope_set:
            raise DailyFetchError(f"gh token lacks scope {needed!r} (scopes={sorted(scope_set)})")
    logger.info("preflight: gh auth OK scopes=%s", sorted(scope_set))

    token = run_cmd(["gh", "auth", "token"]).stdout.strip()
    repo = run_cmd(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).stdout.strip()
    if not token or not repo:
        raise DailyFetchError("could not resolve GH_TOKEN / GH_REPO from gh")
    logger.info("preflight: GH_REPO=%s", repo)

    # 3. requests importable
    run_cmd([sys.executable, "-c", "import requests"])
    logger.info("preflight: requests import OK")

    # 4. disk
    free_gb = shutil.disk_usage(BOT_DIR).free / 1e9
    if free_gb < MIN_FREE_GB:
        raise DailyFetchError(f"free disk {free_gb:.1f} GB < {MIN_FREE_GB} GB")
    logger.info("preflight: free disk %.1f GB OK", free_gb)

    return {"GH_TOKEN": token, "GH_REPO": repo}


def fetch_published_day() -> str | None:
    """latestSnapshotDate currently served by the site (Range GET of the first 512 bytes)."""
    import requests

    try:
        resp = requests.get(
            SITE_RANKINGS_URL,
            params={"_": int(time.time())},
            headers={"Range": "bytes=0-511", "Cache-Control": "no-cache"},
            timeout=30,
        )
        if resp.status_code not in (200, 206):
            logger.warning("published check: HTTP %s", resp.status_code)
            return None
        return extract_latest_snapshot_date(resp.text[:512])
    except requests.RequestException as exc:
        logger.warning("published check failed: %s", exc)
        return None


def build_main_env(extras: dict[str, str], now_jst: datetime) -> dict[str, str]:
    env = dict(os.environ)
    env.update(parse_env_file(PRODUCTION_ENV_PATH.read_text(encoding="utf-8")))
    env.update(extras)
    env["ENFORCE_JST_FETCH_WINDOW"] = "true" if should_wait_for_update(now_jst) else ""
    env["FORCE_RANKING_FETCH"] = ""
    env["SKIP_MSU_RANKING_FETCH"] = ""
    env["SKIP_DEPLOY_IF_DAY_CAPTURED"] = "false"
    env["SNAPSHOT_GUARD_RELEASE_RESTORED"] = "true"
    env["SNAPSHOT_GUARD_CACHE_HIT"] = "false"
    env["PYTHONUTF8"] = "1"
    return env


def download_release_db(db_path: Path) -> None:
    """Replace the local DB with the Release copy (the local file is only a cache)."""
    import gzip

    from release_store import ReleaseStoreError, download_current_asset

    gz_path = db_path.with_suffix(".db.gz.from_release")
    try:
        found = download_current_asset(gz_path)
    except ReleaseStoreError as exc:
        raise DailyFetchError(f"Release download failed: {exc}") from exc
    if not found:
        raise DailyFetchError("Release db-store asset not found (refusing to seed from local)")

    for suffix in ("", "-wal", "-shm"):
        src = Path(str(db_path) + suffix)
        if src.exists():
            bak = Path(str(db_path) + suffix + ".bak")
            if bak.exists():
                bak.unlink()
            src.replace(bak)
    with gzip.open(gz_path, "rb") as s, open(db_path, "wb") as d:
        shutil.copyfileobj(s, d)
    gz_path.unlink()
    logger.info("Release DB restored: %s (%.0f MB)", db_path, db_path.stat().st_size / 1e6)


def run_main_py(env: dict[str, str]) -> int:
    logger.info("running main.py (ENFORCE_JST_FETCH_WINDOW=%r)", env["ENFORCE_JST_FETCH_WINDOW"])
    proc = subprocess.Popen(
        [sys.executable, "main.py"],
        cwd=BOT_DIR,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        logger.info("[main] %s", line.rstrip())
    return proc.wait()


def dispatch_and_wait() -> None:
    """Dispatch the Pages workflow and wait for success; re-dispatch up to 2x on cancel/failure."""
    import json

    for attempt in range(DISPATCH_MAX_RETRIES + 1):
        t0 = datetime.now(timezone.utc) - timedelta(seconds=10)
        run_cmd(
            ["gh", "workflow", "run", WORKFLOW_FILE, "-f", "force_fetch=false", "-f", "wait_for_update=false"]
        )
        logger.info("dispatched %s (attempt %d)", WORKFLOW_FILE, attempt + 1)

        run_id = None
        deadline = time.time() + 120
        while time.time() < deadline and run_id is None:
            time.sleep(5)
            out = run_cmd(
                ["gh", "run", "list", "--workflow", WORKFLOW_FILE, "--event", "workflow_dispatch",
                 "--limit", "5", "--json", "databaseId,createdAt"]
            ).stdout
            for r in sorted(json.loads(out), key=lambda r: r["databaseId"], reverse=True):
                created = datetime.fromisoformat(r["createdAt"].replace("Z", "+00:00"))
                if created >= t0:
                    run_id = r["databaseId"]
                    break
        if run_id is None:
            raise DailyFetchError("dispatched run not found within 120s")
        logger.info("run id %s", run_id)

        conclusion = None
        deadline = time.time() + RUN_WAIT_TIMEOUT_SEC
        while time.time() < deadline:
            out = run_cmd(["gh", "run", "view", str(run_id), "--json", "status,conclusion"]).stdout
            info = json.loads(out)
            if info["status"] == "completed":
                conclusion = info["conclusion"]
                break
            time.sleep(POLL_SEC)
        logger.info("run %s conclusion=%s", run_id, conclusion)
        if conclusion == "success":
            return
        if attempt < DISPATCH_MAX_RETRIES:
            logger.warning("re-dispatching in %ds", DISPATCH_RETRY_INTERVAL_SEC)
            time.sleep(DISPATCH_RETRY_INTERVAL_SEC)
            continue
        raise DailyFetchError(f"workflow run {run_id} ended with {conclusion!r} after {attempt + 1} attempts")


def wait_for_site(expected_day: str) -> None:
    deadline = time.time() + SITE_WAIT_TIMEOUT_SEC
    while True:
        day = fetch_published_day()
        if day == expected_day:
            logger.info("site serves latestSnapshotDate=%s", day)
            return
        if time.time() >= deadline:
            raise DailyFetchError(f"site latestSnapshotDate={day!r} != {expected_day!r} after {SITE_WAIT_TIMEOUT_SEC}s")
        time.sleep(POLL_SEC)


# --------------------------------------------------------------------------
# orchestration
# --------------------------------------------------------------------------


def run(dry_run: bool, expected_day: str) -> None:
    sys.path.insert(0, str(BOT_DIR))
    extras = preflight()
    os.environ.update(extras)  # release_store / gh read these
    now_jst = datetime.now(JST)

    published = fetch_published_day()
    logger.info("published latestSnapshotDate=%s expected=%s", published, expected_day)
    if published == expected_day:
        logger.info("already published -> nothing to do")
        return

    env = build_main_env(extras, now_jst)
    for k in ("SQLITE_DB_PATH",):
        os.environ[k] = env[k]
    import config
    from sqlite_storage import count_snapshot_dates, count_snapshots_for_date, latest_snapshot_date

    db_path = config.sqlite_db_path()

    if dry_run:
        logger.info("[dry-run] would: download Release DB -> %s", db_path)
        logger.info("[dry-run] would: run main.py unless Release already has %s (>=%d rows)", expected_day, G3_MIN_ROWS)
        logger.info("[dry-run] would: gates G1-G4 -> sync_db_to_release -> dispatch %s -> wait site", WORKFLOW_FILE)
        logger.info("[dry-run] ENFORCE_JST_FETCH_WINDOW would be %r", env["ENFORCE_JST_FETCH_WINDOW"])
        logger.info("[dry-run] no API request / Release write / dispatch was made")
        return

    download_release_db(db_path)
    days_before = count_snapshot_dates(db_path)
    rows_expected = count_snapshots_for_date(db_path, expected_day)
    logger.info("Release DB: days=%d rows(%s)=%d", days_before, expected_day, rows_expected)

    if rows_expected >= G3_MIN_ROWS:
        logger.info("Release already has %s: skip fetch, redo dispatch + publish check only", expected_day)
    else:
        rc = run_main_py(env)
        gate = GateInput(
            main_rc=rc,
            expected_day=expected_day,
            latest_day=latest_snapshot_date(db_path),
            expected_day_rows=count_snapshots_for_date(db_path, expected_day),
            days_before=days_before,
            days_after=count_snapshot_dates(db_path),
        )
        failed = evaluate_gates(gate)
        if failed:
            raise DailyFetchError("gates failed, Release NOT written: " + "; ".join(failed))
        logger.info("gates G1-G4 OK: %s", gate)

        from release_store import sync_db_to_release

        result = sync_db_to_release(db_path)
        logger.info("Release sync: %s", result)
        if not result.get("uploaded"):
            raise DailyFetchError(f"Release sync did not upload: {result}")

    dispatch_and_wait()
    wait_for_site(expected_day)


def setup_logging(now_jst: datetime) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"daily_fetch_{now_jst:%Y-%m-%d}.log"
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    for h in (logging.FileHandler(log_path, encoding="utf-8"), logging.StreamHandler(sys.stdout)):
        h.setFormatter(fmt)
        root.addHandler(h)
    return log_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--expected-day", help="dry-run only: override the computed ranking_day (to exercise the plan path)")
    args = parser.parse_args(argv)
    if args.expected_day and not args.dry_run:
        parser.error("--expected-day requires --dry-run")

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    now_jst = datetime.now(JST)
    log_path = setup_logging(now_jst)
    sys.path.insert(0, str(BOT_DIR))
    from main import snapshot_date_ranking  # the one definition of ranking_day

    expected_day = args.expected_day or snapshot_date_ranking()
    logger.info("=== daily_fetch start dry_run=%s expected_day=%s ===", args.dry_run, expected_day)
    try:
        run(args.dry_run, expected_day)
    except BaseException as exc:  # noqa: BLE001 - every failure must be visible
        if isinstance(exc, SystemExit) and exc.code in (0, None):
            return 0
        logger.error("FAILED: %s", exc, exc_info=not isinstance(exc, DailyFetchError))
        try:
            m = write_failure_marker(expected_day, f"{type(exc).__name__}: {exc}", log_path)
            logger.error("failure marker written: %s", m)
        except OSError as marker_exc:
            logger.error("could not write failure marker: %s", marker_exc)
        return 1
    if not args.dry_run:
        clear_failure_marker(expected_day)
    logger.info("=== daily_fetch OK ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
