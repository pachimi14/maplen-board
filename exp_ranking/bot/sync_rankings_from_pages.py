"""Download rankings.json from GitHub Pages (same file the public site uses)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import requests

DEFAULT_PAGES_URL = (
    "https://pachimi14.github.io/msu-exp-ranking/data/rankings.json"
)
DEFAULT_OUTPUT = (
    Path(__file__).resolve().parent.parent / "web" / "public" / "data" / "rankings.json"
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync local rankings.json from GitHub Pages (production data)."
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_PAGES_URL,
        help="rankings.json URL (default: production GitHub Pages)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Output path for rankings.json",
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

    print("[OK] Synced production rankings.json")
    print(f"     characters: {meta.get('characterCount', '?')}")
    print(f"     min level:  Lv.{meta.get('rankingMinLevel', '?')}+")
    print(f"     latest:     {meta.get('latestSnapshotDate', '?')}")
    print(f"     path:       {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
