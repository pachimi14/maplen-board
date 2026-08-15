"""IMPL_PLAN_SH32 §2 A / A-1: daily DISCOVERY (bonus period) scan.

Intended to run as a one-shot process under a systemd timer, once a day
(`deploy/sf-history-discovery-scan.timer.example`) -- same "ワンショット +
timer" discipline as `scripts/update.py` (design §5.2, OPS-1's lesson).

1. Enumerate every item via `/stats/enhance-group` (POST, all filters empty)
   -> `/stats/enhance-group/items` (GET, per group) -- plan §0 F6: 84 groups,
   472 items. Both endpoints are the same unauthenticated `msu.io` Dynamic
   Pricing API `item_catalog.py` (maplenEnhancebot) already uses -- this
   script does NOT reuse that module's `fetch_enhance_groups`/
   `fetch_group_items` (those default to `boss_only=True`/`min_level=100`,
   which would not enumerate the full 472; plan §0 F6 needs every group), it
   only reuses `pick_representative_item` (plan §2 A-1: "別の規則を発明しな
   い"), imported read-only exactly like `scripts/gen_item_list.py` already
   does.
2. For every item, GET the official Open API `dynamicprice` endpoint (the
   SAME upstream `fetch_latest.py`'s `_fetch_openapi` calls, GET-only, so it
   goes through `fetcher.Fetcher` like every other HTTP call in this repo)
   and read every band's CURRENT `step` (plan §0 F1/F4 -- `discovery.
   parse_dynamicprice_steps`). Partial success: one item's failure is logged
   and skipped, never aborts the run (plan §2: "1装備の失敗で全体を落とさな
   い").
3. A group is a monitoring *candidate* if any member has a DISCOVERY band in
   itemUpgrade 0..21 (plan §1 judge range, `discovery.is_monitored`). For
   every candidate group: verify every member's full (0..24) step list
   matches the picked representative's (`discovery.steps_consistent`, plan §2
   A-1's F7-for-step re-check) -- consistent -> upsert
   `sf_discovery_monitored_groups` (representative + all member aliases);
   inconsistent -> log a warning and leave that group's row untouched this
   run ("畳まず、警告をログに出す" -- never silently distribute the
   representative's numbers to aliases that just proved not identical).
   Every candidate group's members get a raw per-band snapshot written to
   `sf_discovery_scan_raw` regardless of the consistency outcome (plan §2:
   "生のまま残す").
4. Any group that WAS active but is no longer a candidate this run is
   flipped `is_active=0` (row kept forever, plan §5(k)).

Usage:
    python scripts/scan_discovery.py
    python scripts/scan_discovery.py --db data/x.sqlite --max-requests 900
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db  # noqa: E402
import discovery  # noqa: E402
import fetch_latest  # noqa: E402
import fetcher as fetcher_mod  # noqa: E402

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "sf_price_history.sqlite"
DEFAULT_SOURCE_REPO = Path(r"C:\Users\pachi\Desktop\maplenEnhancebot")

ENHANCE_GROUP_URL = "https://msu.io/maplestoryn/api/msn/dynamicpricing/stats/enhance-group"
ENHANCE_GROUP_ITEMS_URL = "https://msu.io/maplestoryn/api/msn/dynamicpricing/stats/enhance-group/items"

# plan §0 F8: ~0.25s delay measured for the real 472-item walk -- deliberately
# shorter than fetcher.MIN_INTERVAL_SEC (1.0s, tuned for the much smaller
# `history` backfill endpoint); still sequential, still logged, still subject
# to the same 429 backoff/hard-stop discipline (fetcher.py itself unchanged).
SCAN_MIN_INTERVAL_SEC = 0.25
DEFAULT_MAX_REQUESTS = 900  # 1 (or 2) group-listing POST + 84 item-listing GET + 472 dynamicprice GET, with headroom

PickRepresentativeItem = Callable[[list[dict[str, Any]]], dict[str, Any] | None]


def _default_pick_representative_item(source_repo: Path) -> PickRepresentativeItem:
    """maplenEnhancebot read-only import (never writes into that tree --
    `sys.dont_write_bytecode` guard, same precedent as
    `scripts/gen_item_list.py`'s `_load_source_modules`). Only ever called by
    `main()` -- `run_scan` itself takes `pick_representative_item` as a
    parameter so tests never need this import at all (offline, hermetic)."""
    sys.dont_write_bytecode = True
    source_repo_str = str(source_repo)
    if source_repo_str not in sys.path:
        sys.path.insert(0, source_repo_str)
    import item_catalog  # type: ignore

    return item_catalog.pick_representative_item


def fetch_all_groups(fetcher: fetcher_mod.Fetcher, *, page_size: int = 100) -> list[dict[str, Any]]:
    """POST `/stats/enhance-group`, every filter empty -> every group (plan §0
    F6: 84). `fetcher_mod.Fetcher.get` is GET-only; this is the one place a
    POST is needed (at most a couple of calls -- 84 groups fit in one
    `page_size=100` page today), so it paces itself by `fetcher.
    min_interval_sec` manually on the SAME session/User-Agent rather than
    extending `fetcher.py` (not in IMPL_PLAN_SH32 §4's allowed-to-touch
    list).
    """
    groups: list[dict[str, Any]] = []
    page = 1
    while True:
        payload = {
            "itemUpgradeType": None,
            "equipType": [],
            "equipPartType": [],
            "equipLevelType": [],
            "pagination": {"size": page_size, "no": page},
        }
        time.sleep(fetcher.min_interval_sec)
        response = fetcher.session.post(ENHANCE_GROUP_URL, json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()
        page_groups = data.get("groups") or []
        groups.extend(page_groups)
        total = int((data.get("pagination") or {}).get("totalRecord") or 0)
        if len(groups) >= total or not page_groups:
            break
        page += 1
    return groups


def fetch_group_items(fetcher: fetcher_mod.Fetcher, group: dict[str, Any]) -> list[dict[str, Any]] | None:
    """GET `/stats/enhance-group/items` for one group. `None` on any
    failure (plan §2: "部分成功でよい") -- the caller logs and skips."""
    meta = group.get("group") or {}
    params = {
        "equipLevelType": meta.get("equipLevelType"),
        "equipType": meta.get("equipType"),
        "equipPartType": meta.get("equipPartType"),
    }
    try:
        status, payload, _text = fetcher.get(
            ENHANCE_GROUP_ITEMS_URL, params, endpoint="enhance-group-items", note=str(meta)
        )
    except requests.RequestException as exc:
        print(f"scan_discovery: enhance-group-items failed for {meta}: {exc}", file=sys.stderr)
        return None
    if status != 200 or payload is None:
        print(f"scan_discovery: enhance-group-items HTTP {status} for {meta}", file=sys.stderr)
        return None
    return payload.get("items") or []


def fetch_item_steps(fetcher: fetcher_mod.Fetcher, item_id: int) -> list[str | None] | None:
    """GET the Open API `dynamicprice` endpoint for one item and return its
    25-band step list (`discovery.parse_dynamicprice_steps`). `None` on any
    failure -- caller counts it in `items_failed` and moves on."""
    url = fetch_latest.OPEN_API_URL_TEMPLATE.format(item_id=item_id)
    try:
        status, payload, _text = fetcher.get(url, {}, endpoint="dynamicprice", note=f"item={item_id}")
    except requests.RequestException as exc:
        print(f"scan_discovery: dynamicprice failed for item={item_id}: {exc}", file=sys.stderr)
        return None
    if status != 200 or payload is None:
        print(f"scan_discovery: dynamicprice HTTP {status} for item={item_id}", file=sys.stderr)
        return None
    try:
        return discovery.parse_dynamicprice_steps(payload)
    except discovery.InvalidDynamicPricePayload as exc:
        print(f"scan_discovery: dynamicprice payload invalid for item={item_id}: {exc}", file=sys.stderr)
        return None


def run_scan(
    *,
    db_path: Path,
    fetcher: fetcher_mod.Fetcher,
    pick_representative_item: PickRepresentativeItem,
    now: datetime | None = None,
) -> dict[str, Any]:
    """The full scan, given an already-constructed `fetcher` (tests inject a
    fake session; `main()` below builds the real one) and a
    `pick_representative_item` callable (tests inject a trivial stand-in so
    they never need maplenEnhancebot on `sys.path` at all).
    """
    if now is None:
        now = datetime.now(timezone.utc)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    start = time.monotonic()

    conn = db.connect(db_path)
    db.apply_schema(conn)

    groups = fetch_all_groups(fetcher)

    # group_key (equipLevelType, equipType, equipPartType) -> resolved members
    # (raw item dict + `itemId` coerced to int + `steps`). A member that
    # failed to fetch is simply absent (plan §2: "部分成功でよい").
    items_by_group: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    items_total = 0
    items_failed = 0

    for group in groups:
        meta = group.get("group") or {}
        group_key = (meta.get("equipLevelType"), meta.get("equipType"), meta.get("equipPartType"))
        members = fetch_group_items(fetcher, group)
        if members is None:
            continue
        resolved_members: list[dict[str, Any]] = []
        for member in members:
            item_id = int(member["itemId"])
            items_total += 1
            steps = fetch_item_steps(fetcher, item_id)
            if steps is None:
                items_failed += 1
                continue
            resolved_members.append({**member, "itemId": item_id, "steps": steps})
        if resolved_members:
            items_by_group[group_key] = resolved_members

    monitored_count = 0
    still_active_ids: set[int] = set()
    preserved_ids: set[int] = set()  # inconsistent this run -- freeze, don't deactivate (see below)
    # (item_id, steps) for every member of every CANDIDATE group this run,
    # written after `run_id` is allocated below (plan §2: "生のまま残す" --
    # unconditional on the consistency outcome).
    raw_writes: list[tuple[int, list[str | None]]] = []

    for group_key, members in items_by_group.items():
        equip_level_type, equip_type, equip_part_type = group_key
        if not any(discovery.is_monitored(m["steps"]) for m in members):
            continue  # not a candidate this run -- plan §1 judge range

        # ★2026-08-15 fix (統括 検収差し戻し): the group's identity is
        # `group_key`, not whichever member currently has the highest
        # weekCount -- `pick_representative_item` is only ever called again
        # when this group has NEVER been registered before, or when its
        # already-fixed representative has dropped out of the group's own
        # current member list (logged below, the one case a fixed
        # representative is allowed to change).
        member_by_id = {int(m["itemId"]): m for m in members}
        existing = db.get_discovery_monitored_group_by_group_key(
            conn, equip_level_type, equip_type, equip_part_type
        )
        if existing is not None and existing["itemId"] in member_by_id:
            representative = member_by_id[existing["itemId"]]
            representative_id = existing["itemId"]
        else:
            if existing is not None:
                print(
                    f"scan_discovery: WARNING representative item={existing['itemId']} for group "
                    f"{group_key} is no longer among the group's current members -- re-selecting "
                    "a new representative (the only case a fixed representative may change)",
                    file=sys.stderr,
                )
                # Clears the old row's slot in the partial unique index
                # (schema.sql, WHERE is_active = 1) BEFORE the new
                # representative's row is inserted below -- ordering matters.
                db.deactivate_discovery_group(conn, existing["itemId"], now=now_iso)
            representative = pick_representative_item(members)
            if representative is None:
                continue
            representative_id = int(representative["itemId"])

        member_steps = {int(m["itemId"]): m["steps"] for m in members}
        consistent = discovery.steps_consistent(member_steps)

        raw_writes.extend((int(m["itemId"]), m["steps"]) for m in members)

        if not consistent:
            print(
                f"scan_discovery: WARNING steps inconsistent within group {group_key} "
                f"(representative={representative_id}) -- not folding this run (plan §2 A-1)",
                file=sys.stderr,
            )
            # §2 A-1: "畳まず" -- do not upsert monitored_groups this run. Also
            # do not let this run's inconsistency deactivate a group that was
            # already active from a previous, consistent scan (an
            # inconsistency freezes the group's active state, it does not
            # revoke it -- the only unconditional effect is the raw snapshot
            # above plus the warning here).
            preserved_ids.add(representative_id)
            continue

        aliases = sorted(
            ({"itemId": int(m["itemId"]), "itemName": m.get("itemName")} for m in members),
            key=lambda a: a["itemId"],
        )
        db.upsert_discovery_monitored_group(
            conn,
            representative_item_id=representative_id,
            item_name=representative.get("itemName"),
            equip_level_type=equip_level_type,
            equip_type=equip_type,
            equip_part_type=equip_part_type,
            alias_item_ids=[a["itemId"] for a in aliases],
            aliases=aliases,
            steps_consistent=True,
            is_active=True,
            now=now_iso,
        )
        monitored_count += 1
        still_active_ids.add(representative_id)

    db.deactivate_discovery_groups_not_in(conn, still_active_ids | preserved_ids, now=now_iso)

    run_id = db.record_discovery_scan_run(
        conn,
        run_at=now_iso,
        groups_total=len(groups),
        items_total=items_total,
        items_failed=items_failed,
        monitored_groups=monitored_count,
        duration_ms=(time.monotonic() - start) * 1000.0,
    )
    for item_id, steps in raw_writes:
        db.insert_discovery_scan_raw_rows(conn, run_id, item_id, steps, now_iso)

    conn.close()

    return {
        "groupsTotal": len(groups),
        "itemsTotal": items_total,
        "itemsFailed": items_failed,
        "monitoredGroups": monitored_count,
        "requestsMade": fetcher.total_requests,
        "total429": fetcher.total_429,
        "durationMs": round((time.monotonic() - start) * 1000.0, 1),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--source-repo", type=Path, default=DEFAULT_SOURCE_REPO)
    parser.add_argument("--max-requests", type=int, default=DEFAULT_MAX_REQUESTS)
    args = parser.parse_args()

    api_key = os.getenv("MSU_OPEN_API_KEY", "")  # ★秘密情報 -- never logged, same discipline as app.py's _open_api_key()
    if not api_key:
        print("scan_discovery: MSU_OPEN_API_KEY is not set -- cannot query the Open API. Aborting.", file=sys.stderr)
        return 2

    ftr = fetcher_mod.Fetcher(min_interval_sec=SCAN_MIN_INTERVAL_SEC, max_requests=args.max_requests)
    ftr.session.headers["x-nxopen-api-key"] = api_key
    ftr.session.headers["Content-Type"] = "application/json"

    pick_representative_item = _default_pick_representative_item(args.source_repo)

    try:
        result = run_scan(db_path=args.db, fetcher=ftr, pick_representative_item=pick_representative_item)
    except (
        fetcher_mod.RequestBudgetExceededError,
        fetcher_mod.ConsecutiveTooManyRequestsError,
        fetcher_mod.TotalTooManyRequestsExceededError,
    ) as exc:
        print(f"scan_discovery: stopped early: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2

    print(
        f"scan_discovery: groups={result['groupsTotal']} items={result['itemsTotal']} "
        f"failed={result['itemsFailed']} monitoredGroups={result['monitoredGroups']} "
        f"requests={result['requestsMade']} x429={result['total429']} "
        f"durationMs={result['durationMs']}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
