"""Home-PC daily SF/CUBE price fetch driver (IMPL_PLAN_SH47).

The official history endpoint answers 403 to the VPS (LULU-153), so this PC
fetches once a day and ships only the increment to the VPS:

    preflight -> scripts/update.py (fetch, ALL combos; unchanged) ->
    scripts/export_increment.py -> ssh (forced command) -> ingest_increment.py on the VPS
    -> judge the one-line JSON result.

No fetch/derivation rule lives here: update.py / export_increment.py /
ingest_increment.py are run as subprocesses, unchanged. A run that dies midway
needs no special recovery: update.py's window starts at each combo's
MAX(price_at) - 8h, so tomorrow's window simply grows (no permanent gap).

Usage:  python ops/sf_daily_fetch.py [--dry-run] [--no-deliver] [--days N]
  --dry-run     : show route and config only. No fetch, no export, no transfer.
  --no-deliver  : fetch + export only. Nothing is sent to the VPS.

Delivery config (environment variables; never put key material in this repo):
  SF_DELIVER_SSH_KEY     path to the dedicated private key file (required to deliver)
  SF_DELIVER_TARGET      user@host (default botuser@163.44.118.206)
The key must be a dedicated one whose authorized_keys line carries a forced
command + restrict (see ops/README.md). The root key is never used here.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

SF_DIR = Path(__file__).resolve().parent.parent
LOG_DIR = SF_DIR / "logs"
SCRIPTS_DIR = SF_DIR / "scripts"
DEFAULT_DB_PATH = SF_DIR / "data" / "sf_price_history.sqlite"
ITEMS_PATH = SF_DIR / "data" / "sf_history_items.json"

JST = timezone(timedelta(hours=9))
DEFAULT_TARGET = "botuser@163.44.118.206"
DEFAULT_DAYS = 3
UPDATE_TIMEOUT_SEC = 90 * 60
DELIVER_TIMEOUT_SEC = 20 * 60
MAX_GZIP_BYTES = 8 * 1024 * 1024  # plan expects <= ~1 MiB for 3 days; far above that means something is wrong

logger = logging.getLogger("sf_daily_fetch")


class SfDailyFetchError(Exception):
    pass


def desktop_dir() -> Path:
    return Path(os.environ.get("USERPROFILE") or Path.home()) / "Desktop"


def marker_path(day: str) -> Path:
    return desktop_dir() / f"LULUMI_SF_FETCH_FAILED_{day}.txt"


def write_failure_marker(day: str, reason: str, log_path: Path) -> Path:
    path = marker_path(day)
    path.parent.mkdir(parents=True, exist_ok=True)
    one_line = " ".join(reason.split())[:300]
    path.write_text(f"{one_line}\nlog: {log_path}\n", encoding="utf-8")
    return path


def clear_failure_marker(day: str) -> None:
    try:
        marker_path(day).unlink()
    except FileNotFoundError:
        pass


def build_ssh_command(key_path: str, target: str) -> list[str]:
    """No remote command is passed: the server-side forced command decides what runs."""
    return [
        "ssh",
        "-i", key_path,
        "-o", "BatchMode=yes",
        "-o", "IdentitiesOnly=yes",
        "-o", "StrictHostKeyChecking=yes",
        "-o", "ConnectTimeout=30",
        target,
    ]


def parse_ingest_result(stdout_text: str) -> dict[str, Any]:
    """The ingest prints exactly one JSON line; judge it fail-closed."""
    lines = [ln for ln in stdout_text.splitlines() if ln.strip()]
    if not lines:
        raise SfDailyFetchError("deliver: VPS returned no result line")
    try:
        result = json.loads(lines[-1])
    except ValueError as exc:
        raise SfDailyFetchError(f"deliver: result line is not JSON: {lines[-1][:200]!r}") from exc
    for key in ("insertedSf", "insertedCube", "combosTouched", "maxPriceAt", "integrity"):
        if key not in result:
            raise SfDailyFetchError(f"deliver: result JSON lacks {key!r}: {lines[-1][:200]!r}")
    if result["integrity"] != "ok":
        raise SfDailyFetchError(f"deliver: VPS integrity={result['integrity']!r} (restore the pre-ingest snapshot)")
    return result


def run_logged(args: list[str], *, timeout: int, stdin=None, capture_stdout: bool = False) -> subprocess.CompletedProcess:
    logger.info("run: %s", " ".join(args))
    proc = subprocess.run(
        args, cwd=SF_DIR, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=timeout, text=True, encoding="utf-8", errors="replace",
    )
    for stream in (proc.stderr, None if capture_stdout else proc.stdout):
        for line in (stream or "").splitlines():
            logger.info("  | %s", line)
    return proc


def run(args: argparse.Namespace, day: str) -> None:
    db_path = Path(args.db)
    key = os.environ.get("SF_DELIVER_SSH_KEY", "")
    target = os.environ.get("SF_DELIVER_TARGET", DEFAULT_TARGET)
    out_path = LOG_DIR / f"increment_{day}.jsonl.gz"
    deliver = not args.no_deliver

    logger.info("db=%s exists=%s items_exists=%s", db_path, db_path.is_file(), ITEMS_PATH.is_file())
    logger.info("deliver=%s target=%s key_configured=%s days=%s", deliver, target, bool(key), args.days)
    if args.dry_run:
        logger.info("[dry-run] would: python scripts/update.py --db %s   (SF + CUBE, ~884 requests)", db_path)
        logger.info("[dry-run] would: python scripts/export_increment.py --days %s --out %s", args.days, out_path)
        if deliver:
            logger.info("[dry-run] would: %s < %s", " ".join(build_ssh_command(key or "<SF_DELIVER_SSH_KEY>", target)), out_path)
        else:
            logger.info("[dry-run] --no-deliver: no transfer")
        logger.info("[dry-run] no request / export / transfer was made")
        return

    if not db_path.is_file():
        raise SfDailyFetchError(
            f"local DB missing: {db_path}. Run the one-time backfill first "
            "(scripts/backfill.py and scripts/cube_backfill.py, see ops/README.md)."
        )
    if not ITEMS_PATH.is_file():
        raise SfDailyFetchError(f"items file missing: {ITEMS_PATH}")
    if deliver:
        if not key or not Path(key).is_file():
            raise SfDailyFetchError("SF_DELIVER_SSH_KEY is not set or not a file (use --no-deliver to rehearse)")

    py = sys.executable
    proc = run_logged([py, str(SCRIPTS_DIR / "update.py"), "--db", str(db_path)], timeout=UPDATE_TIMEOUT_SEC)
    if proc.returncode != 0:
        raise SfDailyFetchError(
            f"update.py exit {proc.returncode} (2=SF safety net, 3=CUBE safety net/error); "
            "NOT delivering. Tomorrow's window grows automatically."
        )

    proc = run_logged(
        [py, str(SCRIPTS_DIR / "export_increment.py"), "--db", str(db_path), "--days", str(args.days), "--out", str(out_path)],
        timeout=15 * 60, capture_stdout=True,
    )
    if proc.returncode != 0:
        raise SfDailyFetchError(f"export_increment.py exit {proc.returncode}")
    try:
        summary = json.loads(proc.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError) as exc:
        raise SfDailyFetchError("export_increment.py printed no summary JSON") from exc
    logger.info("export summary: %s", summary)
    if summary["rowsSf"] + summary["rowsCube"] == 0:
        raise SfDailyFetchError("export produced 0 rows (is the local DB empty/stale?)")
    if summary["gzipBytes"] > MAX_GZIP_BYTES:
        raise SfDailyFetchError(f"export is {summary['gzipBytes']} bytes (> {MAX_GZIP_BYTES}); refusing to send")

    if not deliver:
        logger.info("--no-deliver: stopping after export (%s)", out_path)
        return

    with open(out_path, "rb") as fh:
        proc = run_logged(build_ssh_command(key, target), timeout=DELIVER_TIMEOUT_SEC, stdin=fh, capture_stdout=True)
    if proc.returncode != 0:
        raise SfDailyFetchError(f"ssh/ingest exit {proc.returncode}")
    result = parse_ingest_result(proc.stdout)
    logger.info("deliver OK: %s", result)


def setup_logging(now_jst: datetime) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"sf_daily_fetch_{now_jst:%Y-%m-%d}.log"
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
    parser.add_argument("--no-deliver", action="store_true")
    parser.add_argument("--days", type=float, default=DEFAULT_DAYS, help="export window (use ~10 for the very first delivery)")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    args = parser.parse_args(argv)

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    now_jst = datetime.now(JST)
    day = f"{now_jst:%Y-%m-%d}"
    log_path = setup_logging(now_jst)
    logger.info("=== sf_daily_fetch start dry_run=%s no_deliver=%s ===", args.dry_run, args.no_deliver)
    try:
        run(args, day)
    except BaseException as exc:  # noqa: BLE001 - every failure must be visible
        if isinstance(exc, SystemExit) and exc.code in (0, None):
            return 0
        logger.error("FAILED: %s", exc, exc_info=not isinstance(exc, SfDailyFetchError))
        try:
            m = write_failure_marker(day, f"{type(exc).__name__}: {exc}", log_path)
            logger.error("failure marker written: %s", m)
        except OSError as marker_exc:
            logger.error("could not write failure marker: %s", marker_exc)
        return 1
    if not args.dry_run:
        clear_failure_marker(day)
    logger.info("=== sf_daily_fetch OK ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
