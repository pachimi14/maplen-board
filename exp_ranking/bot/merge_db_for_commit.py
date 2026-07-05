from __future__ import annotations

import argparse
from pathlib import Path

from sqlite_storage import checkpoint_db, merge_ranking_databases


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("primary", type=Path)
    parser.add_argument("secondary", type=Path)
    args = parser.parse_args()

    merged = merge_ranking_databases(args.primary, args.secondary)
    checkpoint_db(args.primary)
    print(f"Merged {merged} missing ranking rows into {args.primary}")


if __name__ == "__main__":
    main()
