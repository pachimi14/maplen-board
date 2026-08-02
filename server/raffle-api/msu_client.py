from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone


UPSTREAM_BASE = "https://openapi.msu.io"
NAVIGATOR_BASE = "https://msu.io"
MAX_RESPONSE_BYTES = 1024 * 1024


class UpstreamError(Exception):
    pass


class DailyBudgetExceeded(UpstreamError):
    pass


class GlobalStartLimiter:
    def __init__(self, interval_seconds: float = 1.0, daily_budget: int = 2700) -> None:
        self.interval_seconds = max(interval_seconds, 1.0)
        self.daily_budget = min(max(daily_budget, 1), 3000)
        self._lock = threading.Lock()
        self._last_started = 0.0
        self._budget_day = datetime.now(timezone.utc).date()
        self._started_today = 0

    def wait(self, monotonic=time.monotonic, sleeper=time.sleep) -> None:
        with self._lock:
            today = datetime.now(timezone.utc).date()
            if today != self._budget_day:
                self._budget_day = today
                self._started_today = 0
            if self._started_today >= self.daily_budget:
                raise DailyBudgetExceeded("daily upstream budget exhausted")
            wait_seconds = self.interval_seconds - (monotonic() - self._last_started)
            if wait_seconds > 0:
                sleeper(wait_seconds)
            self._last_started = monotonic()
            self._started_today += 1


def _dig(value: object, *path: str):
    current = value
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _first_text(value: dict, paths: tuple[tuple[str, ...], ...]) -> str:
    for path in paths:
        candidate = _dig(value, *path)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
        if isinstance(candidate, int):
            return str(candidate)
    return ""


def _normalize_character(value: object) -> dict | None:
    if not isinstance(value, dict):
        return None
    asset_key = _first_text(
        value,
        (
            ("assetKey",),
            ("characterAssetKey",),
            ("character", "assetKey"),
            ("target", "assetKey"),
            ("tokenInfo", "assetKey"),
        ),
    )
    display_name = _first_text(
        value,
        (
            ("displayName",),
            ("characterName",),
            ("name",),
            ("keyword",),
            ("common", "name"),
            ("character", "common", "name"),
            ("target", "name"),
        ),
    )
    if not asset_key or not asset_key.startswith("CHAR") or not display_name:
        return None
    level_text = _first_text(
        value,
        (("level",), ("common", "level"), ("character", "common", "level")),
    )
    job_name = _first_text(
        value,
        (
            ("jobName",),
            ("job", "jobName"),
            ("job", "name"),
            ("job", "label"),
            ("common", "job", "jobName"),
            ("common", "job", "name"),
            ("common", "job", "label"),
            ("character", "common", "job", "jobName"),
            ("character", "common", "job", "name"),
        ),
    )
    world_id = _first_text(
        value,
        (
            ("worldId",),
            ("world", "code"),
            ("world", "id"),
            ("common", "world", "code"),
            ("common", "world", "id"),
            ("character", "common", "world", "code"),
            ("character", "common", "world", "id"),
        ),
    )
    image_url = _first_text(
        value,
        (
            ("imageUrl",),
            ("thumbnailUrl",),
            ("image", "characterImageUrl"),
            ("image", "url"),
            ("image", "imageUrl"),
            ("image", "thumbnailUrl"),
            ("character", "image", "characterImageUrl"),
            ("character", "image", "imageUrl"),
        ),
    )
    try:
        level = int(level_text) if level_text else None
    except ValueError:
        level = None
    return {
        "assetKey": asset_key,
        "displayName": display_name,
        "level": level if level is not None and level >= 0 else None,
        "jobName": job_name,
        "worldId": world_id,
        "imageUrl": image_url if image_url.startswith("https://") else "",
    }


@dataclass(frozen=True)
class MsuClient:
    api_key: str
    limiter: GlobalStartLimiter
    timeout_seconds: float = 8.0

    def _request_json(
        self,
        base_url: str,
        path: str,
        *,
        method: str = "GET",
        body: dict | None = None,
        require_api_key: bool = True,
    ) -> dict:
        if require_api_key and not self.api_key:
            raise UpstreamError("MSU_OPEN_API_KEY is not configured")
        if not path.startswith("/") or "://" in path:
            raise ValueError("only fixed relative API paths are allowed")
        headers = {
            "Accept": "application/json",
            "User-Agent": "lulumi-tools-raffle-api/1.0",
        }
        if require_api_key:
            headers["x-nxopen-api-key"] = self.api_key
        encoded_body = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            encoded_body = json.dumps(body, separators=(",", ":")).encode("utf-8")
        raw = b""
        for attempt in range(2):
            self.limiter.wait()
            request = urllib.request.Request(
                base_url + path,
                method=method,
                data=encoded_body,
                headers=headers,
            )
            try:
                with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                    if getattr(response, "status", 0) != 200:
                        raise UpstreamError("unexpected upstream status")
                    raw = response.read(MAX_RESPONSE_BYTES + 1)
                break
            except urllib.error.HTTPError as exc:
                if attempt == 0 and exc.code in {429, 500, 502, 503, 504}:
                    continue
                raise UpstreamError("HTTPError") from exc
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                if attempt == 0:
                    continue
                raise UpstreamError(type(exc).__name__) from exc
        if len(raw) > MAX_RESPONSE_BYTES:
            raise UpstreamError("upstream response is too large")
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise UpstreamError("invalid upstream JSON") from exc
        if not isinstance(payload, dict):
            raise UpstreamError("upstream JSON must be an object")
        return payload

    def get_json(self, path: str) -> dict:
        return self._request_json(UPSTREAM_BASE, path)

    def post_json(self, path: str, body: dict | None = None) -> dict:
        return self._request_json(UPSTREAM_BASE, path, method="POST", body=body or {})

    @staticmethod
    def _data(payload: dict) -> dict:
        if payload.get("success") is not True or not isinstance(payload.get("data"), dict):
            raise UpstreamError("invalid upstream success response")
        return payload["data"]

    def _character_detail(self, asset_key: str) -> dict:
        if not asset_key.startswith("CHAR"):
            raise ValueError("invalid character asset key")
        path = "/v1rc1/characters/" + urllib.parse.quote(asset_key, safe="")
        data = self._data(self.get_json(path))
        character = data.get("character")
        if not isinstance(character, dict):
            raise UpstreamError("invalid character detail response")
        return character

    def get_character(self, asset_key: str) -> dict:
        normalized = _normalize_character(self._character_detail(asset_key))
        if normalized is None:
            raise UpstreamError("invalid character detail response")
        return normalized

    def get_character_private(self, asset_key: str) -> dict:
        character = self._character_detail(asset_key)
        normalized = _normalize_character(character)
        if normalized is None:
            raise UpstreamError("invalid character detail response")
        normalized["walletAddress"] = _first_text(
            character,
            (("owner", "walletAddress"), ("tokenInfo", "ownerWalletAddress")),
        )
        return normalized

    def search_character(self, name: str) -> dict | None:
        query = name.strip()
        params = urllib.parse.urlencode({"keyword": query})
        payload = self._request_json(
            NAVIGATOR_BASE,
            "/navigator/api/navigator/search?" + params,
            require_api_key=False,
        )
        records = payload.get("records")
        if not isinstance(records, list):
            raise UpstreamError("invalid Navigator search response")
        for record in records:
            if not isinstance(record, dict) or record.get("type") != "character":
                continue
            candidate = record.get("character")
            if not isinstance(candidate, dict):
                continue
            candidate_name = _first_text(candidate, (("characterName",), ("name",)))
            asset_key = _first_text(candidate, (("assetKey",),))
            if candidate_name.casefold() != query.casefold() or not asset_key.startswith("CHAR"):
                continue
            normalized = self.get_character(asset_key)
            if not normalized.get("imageUrl"):
                image_url = record.get("imageUrl")
                if isinstance(image_url, str) and image_url.startswith("https://"):
                    normalized["imageUrl"] = image_url
            return normalized
        return None

    def get_character_history(self, asset_key: str, wallet_address: str, raffled_at: str) -> list[dict]:
        if not asset_key.startswith("CHAR") or not wallet_address:
            raise ValueError("character asset key and wallet are required")
        params = urllib.parse.urlencode(
            {"wallet_address": wallet_address, "raffled_at": raffled_at}
        )
        path = (
            "/v1rc1/msn/characters/"
            + urllib.parse.quote(asset_key, safe="")
            + "/raffles/history?"
            + params
        )
        histories = self._data(self.get_json(path)).get("histories")
        if not isinstance(histories, list):
            raise UpstreamError("invalid character raffle history response")
        return [entry for entry in histories if isinstance(entry, dict)]

    def get_layers_static(self) -> list[dict]:
        values = self._data(self.post_json("/v1rc1/msn/layers/static")).get("staticDatas")
        if not isinstance(values, list):
            raise UpstreamError("invalid layer static response")
        return [entry for entry in values if isinstance(entry, dict)]

    def get_item_metadata(self, item_id: int) -> dict:
        if item_id <= 0:
            raise ValueError("item ID must be positive")
        data = self._data(self.get_json(f"/v1rc1/gamemeta/items/{item_id}"))
        item = data.get("item")
        if not isinstance(item, dict):
            raise UpstreamError("invalid item metadata response")
        common = item.get("common") if isinstance(item.get("common"), dict) else {}
        category = item.get("category") if isinstance(item.get("category"), dict) else {}
        image = item.get("image") if isinstance(item.get("image"), dict) else {}
        tier0 = category.get("tier0") if isinstance(category.get("tier0"), dict) else {}
        tier1 = category.get("tier1") if isinstance(category.get("tier1"), dict) else {}
        return {
            "itemId": item_id,
            "itemName": str(common.get("itemName") or "").strip(),
            "categoryLabel": str(category.get("label") or "").strip(),
            "tier0": str(tier0.get("label") or "").strip(),
            "tier1": str(tier1.get("label") or "").strip(),
            "imageUrl": str(image.get("iconImageUrl") or "").strip(),
        }