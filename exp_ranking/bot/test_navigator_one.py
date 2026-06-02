"""Quick test: ranking API -> Navigator API for rank #1."""

from __future__ import annotations

import requests

from navigator import extract_asset_key, fetch_world_id, navigator_character_url

RANKING_URL = (
    "https://msu.io/maplestoryn/api/msn/ranking?"
    "rankingFilter.classCode=-1&rankingFilter.jobCode=-1"
    "&paginationParam.pageSize=15&paginationParam.pageNo=1"
)
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json",
}


def main() -> int:
    response = requests.get(RANKING_URL, timeout=30, headers=HEADERS)
    response.raise_for_status()
    entry = response.json()["ranking"][0]

    asset_key = extract_asset_key(entry)
    session = requests.Session()
    session.headers.update(HEADERS)
    world_id = fetch_world_id(session, asset_key)

    print("rank:", entry.get("rank"))
    print("name:", entry.get("characterName"))
    print("characterAssetKey:", asset_key)
    print("worldId:", world_id)
    print("navigatorUrl:", navigator_character_url(asset_key))
    return 0 if asset_key and world_id else 1


if __name__ == "__main__":
    raise SystemExit(main())
