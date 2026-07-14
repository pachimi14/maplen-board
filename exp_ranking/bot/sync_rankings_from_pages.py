"""Download v2 rankings.json + history shards from GitHub Pages (same data the public site uses)."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import requests

DEFAULT_PAGES_URL = "https://lulumi-tools.com/data/v2/rankings.json"
DEFAULT_OUTPUT = (
    Path(__file__).resolve().parent.parent
    / "web"
    / "public"
    / "data"
    / "v2"
    / "rankings.json"
)


def _base_url(summary_url: str) -> str:
    """Return the URL directory containing rankings.json (i.e. .../data/v2/)."""
    return summary_url.rsplit("/", 1)[0] + "/"


def _sync_history_shards(
    *,
    base_url: str,
    output_root: Path,
    history_base_path: str,
    shard_count: int,
) -> tuple[int, int]:
    """Download all history shards for history_base_path into output_root.

    Returns (ok_count, fail_count).
    """
    history_dir = output_root / Path(history_base_path)
    history_dir.mkdir(parents=True, exist_ok=True)

    ok = 0
    fail = 0
    for shard in range(shard_count):
        shard_name = f"shard-{shard:02d}.json"
        shard_url = f"{base_url}{history_base_path}/{shard_name}"
        try:
            response = requests.get(shard_url, timeout=120)
            response.raise_for_status()
            shard_payload = response.json()
        except requests.RequestException as error:
            print(f"[WARN] Shard download failed ({shard_name}): {error}", file=sys.stderr)
            fail += 1
            continue
        except json.JSONDecodeError as error:
            print(f"[WARN] Shard invalid JSON ({shard_name}): {error}", file=sys.stderr)
            fail += 1
            continue

        (history_dir / shard_name).write_text(
            json.dumps(shard_payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        ok += 1
        print(f"  [{ok + fail}/{shard_count}] {shard_name} OK")

    return ok, fail


def _cleanup_stale_history(v2_root: Path, history_base_path: str) -> None:
    """Remove history date directories other than the one just synced."""
    history_root = v2_root / "history"
    if not history_root.is_dir():
        return

    keep_dir = (v2_root / Path(history_base_path)).resolve()
    for entry in history_root.iterdir():
        if not entry.is_dir():
            continue
        if entry.resolve() == keep_dir:
            continue
        shutil.rmtree(entry)
        print(f"[OK] Removed stale history dir: {entry}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync local v2 rankings.json + history shards from GitHub Pages (production data)."
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_PAGES_URL,
        help="v2 rankings.json (summary) URL (default: production GitHub Pages)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Output path for v2 rankings.json (summary)",
    )
    args = parser.parse_args()

    try:
        response = requests.get(args.url, timeout=120)
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as error:
        print(f"[ERROR] Download failed: {error}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as error:
        print(f"[ERROR] Invalid JSON: {error}", file=sys.stderr)
        return 1

    meta = payload.get("meta") or {}
    if meta.get("demoGains"):
        print(
            "[WARN] Remote data is marked demoGains=true (dummy gains).",
            file=sys.stderr,
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    history_base_path = meta.get("historyBasePath")
    shard_count = meta.get("historyShardCount")

    ok = fail = 0
    if history_base_path and isinstance(shard_count, int) and shard_count > 0:
        print(f"[..] Syncing {shard_count} history shard(s) from {history_base_path}...")
        base_url = _base_url(args.url)
        ok, fail = _sync_history_shards(
            base_url=base_url,
            output_root=args.output.parent,
            history_base_path=history_base_path,
            shard_count=shard_count,
        )
        _cleanup_stale_history(args.output.parent, history_base_path)
    else:
        print(
            "[WARN] Summary meta missing historyBasePath/historyShardCount; "
            "skipping history shard sync.",
            file=sys.stderr,
        )

    print("[OK] Synced production v2 rankings.json")
    print(f"     characters: {meta.get('characterCount', '?')}")
    print(f"     min level:  Lv.{meta.get('rankingMinLevel', '?')}+")
    print(f"     latest:     {meta.get('latestSnapshotDate', '?')}")
    print(f"     path:       {args.output}")
    if history_base_path:
        print(f"     shards:     {ok} ok, {fail} failed (base: {history_base_path})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
