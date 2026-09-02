from __future__ import annotations

import re
import threading
import time
from dataclasses import replace

from fastapi.testclient import TestClient

import app as app_module
from app import _live_processor, create_app
from cache import BoundedTtlCache
from config import Settings
from contracts import CreateJobRequest
from item_metadata_store import ItemMetadataStore


def settings(*, fixture_mode: bool = True, queue_capacity: int = 20) -> Settings:
    return Settings(
        allowed_origins=("https://lulumi-tools.com",),
        fixture_mode=fixture_mode,
        queue_capacity=queue_capacity,
        completed_capacity=50,
        job_ttl_seconds=300,
        upstream_start_interval_ms=1000,
        hard_timeout_seconds=45,
        daily_upstream_budget=2700,
        fixture_delay_ms=1,
        item_cache_db_path=None,
        item_cache_ttl_seconds=30 * 24 * 60 * 60,
    )


def request_body() -> dict:
    return {
        "raffledAt": "2026-07-30T00:00:00Z",
        "characters": [{"memberId": "member-1", "assetKey": "CHARfixture001"}],
    }


def test_fixture_job_contract_does_not_return_asset_key() -> None:
    with TestClient(create_app(settings())) as client:
        created = client.post("/raffle/v1/jobs", json=request_body())
        assert created.status_code == 202
        job_id = created.json()["jobId"]
        payload = None
        for _ in range(100):
            response = client.get("/raffle/v1/jobs/" + job_id)
            assert response.status_code == 200
            payload = response.json()
            if payload["status"] in {"complete", "partial", "error"}:
                break
            time.sleep(0.005)
        assert payload is not None
        assert payload["status"] == "complete"
        assert payload["clears"][0]["members"][0]["memberId"] == "member-1"
        assert {entry["bossName"] for entry in payload["raffleResults"]} == {"Lucid", "Will", "Other Boss"}
        assert {clear["boss"] for clear in payload["clears"]} == {"LUCID", "WILL", "SLIME"}
        assert "assetKey" not in str(payload)
        assert payload["warnings"] == [{"code": "fixture_mode"}]
        assert re.fullmatch(r"0x[0-9a-fA-F]{40}", payload["memberWallets"]["member-1"])


def test_live_mode_fails_closed_without_key(monkeypatch) -> None:
    monkeypatch.delenv("MSU_OPEN_API_KEY", raising=False)
    with TestClient(create_app(settings(fixture_mode=False))) as client:
        response = client.post("/raffle/v1/jobs", json=request_body())
        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "api_key_not_configured"


def test_unknown_fields_and_duplicate_asset_are_rejected() -> None:
    body = request_body()
    body["boss"] = "LOTUS"
    with TestClient(create_app(settings())) as client:
        assert client.post("/raffle/v1/jobs", json=body).status_code == 422

        body = request_body()
        body["characters"].append({"memberId": "member-2", "assetKey": "CHARfixture001"})
        assert client.post("/raffle/v1/jobs", json=body).status_code == 422


def test_cors_only_allows_configured_origin() -> None:
    with TestClient(create_app(settings())) as client:
        allowed = client.get(
            "/raffle/v1/health",
            headers={"Origin": "https://lulumi-tools.com"},
        )
        denied = client.get(
            "/raffle/v1/health",
            headers={"Origin": "https://evil.example"},
        )
        assert allowed.headers["access-control-allow-origin"] == "https://lulumi-tools.com"
        assert "access-control-allow-origin" not in denied.headers


def test_fixture_character_search_and_navigator_resolve() -> None:
    with TestClient(create_app(settings())) as client:
        searched = client.post(
            "/raffle/v1/characters/search",
            json={"query": "pachimi"},
        )
        assert searched.status_code == 200
        assert searched.json()["results"] == [
            {
                "schemaVersion": 3,
                "assetKey": "CHARfixture001",
                "displayName": "pachimi",
                "level": 253,
                "jobName": "Evan",
                "worldId": "fixture-world",
                "imageUrl": "",
            }
        ]
        missing = client.post(
            "/raffle/v1/characters/search",
            json={"query": "pachi"},
        )
        assert missing.status_code == 200
        assert missing.json()["results"] == []

        resolved = client.post(
            "/raffle/v1/characters/resolve",
            json={"memberId": "m1", "assetKey": "CHARfixture001"},
        )
        assert resolved.status_code == 200
        assert "assetKey" not in resolved.json()


def test_live_character_search_uses_server_side_client() -> None:
    class StubMsuClient:
        api_key = "configured"

        def search_character(self, query):
            assert query == "pachimi"
            return {
                "assetKey": "CHARlive001",
                "displayName": "pachimi",
                "level": 253,
                "jobName": "Evan",
                "worldId": "1",
                "imageUrl": "",
            }

    with TestClient(
        create_app(settings(fixture_mode=False), upstream_client=StubMsuClient())
    ) as client:
        response = client.post(
            "/raffle/v1/characters/search",
            json={"query": "pachimi"},
        )
        assert response.status_code == 200
        assert response.json()["results"][0]["assetKey"] == "CHARlive001"


def test_live_job_uses_server_side_history_and_returns_normalized_result() -> None:
    class StubMsuClient:
        api_key = "configured"

        def get_layers_static(self):
            return [{"layerId": 205041, "boss": {"bossName": "Lucid", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Lucid"}}]

        def get_character_private(self, asset_key):
            assert asset_key == "CHARfixture001"
            return {"assetKey": asset_key, "walletAddress": "wallet-test-only"}

        def get_character_history(self, asset_key, wallet_address, raffled_at):
            assert wallet_address == "wallet-test-only"
            return [{"raffledAt": raffled_at, "layerId": 205041, "clearInformations": [{"clearedAt": "2026-07-25T11:35:31Z", "partyCount": 1}], "prizes": [{"itemId": 1, "winCount": {"value": "9000000"}}, {"itemId": 4310218, "winCount": {"value": "4"}}]}]

        def get_item_metadata(self, item_id):
            assert item_id == 4310218
            return {"itemId": item_id, "itemName": "Phantasma Coin", "tier1": "Exchange Currency"}

    with TestClient(create_app(settings(fixture_mode=False), upstream_client=StubMsuClient())) as client:
        created = client.post("/raffle/v1/jobs", json=request_body())
        assert created.status_code == 202
        job_id = created.json()["jobId"]
        payload = None
        for _ in range(100):
            payload = client.get("/raffle/v1/jobs/" + job_id).json()
            if payload["status"] in {"complete", "partial", "error"}:
                break
            time.sleep(0.005)
        assert payload["status"] == "complete"
        assert payload["raffleResults"][0]["bossName"] == "Lucid"
        assert payload["clears"][0]["members"][0]["bossNeso"] == "9000000"
        assert payload["clears"][0]["members"][0]["drops"][0]["name"] == "Phantasma Coin"
        # LULU-069/LULU-103: the resolved owner wallet is now returned, but only
        # under memberWallets (keyed by memberId) -- nowhere else in the payload.
        assert payload["memberWallets"] == {"member-1": "wallet-test-only"}
        payload_without_wallets = {key: value for key, value in payload.items() if key != "memberWallets"}
        assert "wallet" not in str(payload_without_wallets).casefold()
        assert "assetKey" not in str(payload)

def test_metadata_is_hydrated_before_a_later_member_exhausts_the_deadline(monkeypatch) -> None:
    clock = {"now": 0.0}
    metadata_calls = []

    class StubMsuClient:
        def get_layers_static(self):
            return [{"layerId": 205041, "boss": {"bossName": "Lucid", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Lucid"}}]

        def get_character_private(self, asset_key):
            return {"assetKey": asset_key, "walletAddress": "wallet-test-only"}

        def get_character_history(self, asset_key, _wallet_address, raffled_at):
            if asset_key == "CHARfixture002":
                clock["now"] = 2.0
                item_id = 1001000
            else:
                item_id = 4310218
            return [{
                "raffledAt": raffled_at,
                "layerId": 205041,
                "clearInformations": [{"clearedAt": "2026-07-25T11:35:31Z", "partyCount": 2}],
                "prizes": [{"itemId": item_id, "winCount": {"value": "1"}}],
            }]

        def get_item_metadata(self, item_id):
            metadata_calls.append(item_id)
            return {"itemId": item_id, "itemName": "Phantasma Coin", "tier1": "Exchange Currency"}

    monkeypatch.setattr(app_module.time, "monotonic", lambda: clock["now"])
    request = CreateJobRequest.model_validate({
        "raffledAt": "2026-07-30T00:00:00Z",
        "characters": [
            {"memberId": "member-1", "assetKey": "CHARfixture001"},
            {"memberId": "member-2", "assetKey": "CHARfixture002"},
        ],
    })
    processor = _live_processor(
        replace(settings(fixture_mode=False), hard_timeout_seconds=1),
        StubMsuClient(),
        BoundedTtlCache(max_bytes=1024 * 1024),
        BoundedTtlCache(max_bytes=1024 * 1024),
    )

    result = processor(request, lambda _completed, _stage: None, threading.Event())

    assert metadata_calls == [4310218]
    assert result["errors"] == [{"code": "metadata_timeout"}]
    assert result["clears"][0]["members"][0]["drops"][0]["name"] == "Phantasma Coin"

def test_live_processor_reuses_persistent_metadata_after_memory_reset(tmp_path) -> None:
    metadata_calls = []

    class StubMsuClient:
        def __init__(self, fail_metadata: bool = False):
            self.fail_metadata = fail_metadata

        def get_layers_static(self):
            return [{"layerId": 205041, "boss": {"bossName": "Lucid", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Lucid"}}]

        def get_character_private(self, asset_key):
            return {"assetKey": asset_key, "walletAddress": "wallet-test-only"}

        def get_character_history(self, _asset_key, _wallet_address, raffled_at):
            return [{
                "raffledAt": raffled_at,
                "layerId": 205041,
                "clearInformations": [{"clearedAt": "2026-07-25T11:35:31Z", "partyCount": 1}],
                "prizes": [{"itemId": 4310218, "winCount": {"value": "1"}}],
            }]

        def get_item_metadata(self, item_id):
            if self.fail_metadata:
                raise AssertionError("persistent metadata should avoid the upstream call")
            metadata_calls.append(item_id)
            return {
                "itemId": item_id,
                "itemName": "Phantasma Coin",
                "categoryLabel": "Currency",
                "tier0": "Etc",
                "tier1": "Exchange Currency",
                "imageUrl": "https://api-static.msu.io/itemimages/icon/4310218.png",
            }

    request = CreateJobRequest.model_validate(request_body())
    database_path = tmp_path / "item-metadata.sqlite3"
    first_processor = _live_processor(
        settings(fixture_mode=False),
        StubMsuClient(),
        BoundedTtlCache(max_bytes=1024 * 1024),
        BoundedTtlCache(max_bytes=1024 * 1024),
        ItemMetadataStore(database_path),
    )
    first = first_processor(request, lambda _completed, _stage: None, threading.Event())

    second_processor = _live_processor(
        settings(fixture_mode=False),
        StubMsuClient(fail_metadata=True),
        BoundedTtlCache(max_bytes=1024 * 1024),
        BoundedTtlCache(max_bytes=1024 * 1024),
        ItemMetadataStore(database_path),
    )
    second = second_processor(request, lambda _completed, _stage: None, threading.Event())

    assert metadata_calls == [4310218]
    assert first["clears"][0]["members"][0]["drops"][0]["name"] == "Phantasma Coin"
    assert second["clears"][0]["members"][0]["drops"][0]["name"] == "Phantasma Coin"
    assert second["errors"] == []

def test_power_crystal_direct_item_id_needs_no_metadata_and_is_not_fetched() -> None:
    # docs/IMPL_PLAN_RAFFLE_REWARD_VOCAB.md S1: itemId 1000 is a direct Power Crystal grant
    # (quantity IS the amount). It must resolve to POWER_CRYSTAL/settle without ever being
    # requested from upstream metadata (which 404s for it, like NESO's itemId 1) -- a fetch
    # attempt here would previously surface as `item_metadata_unavailable`.
    class StubMsuClient:
        def get_layers_static(self):
            return [
                {"layerId": 205041, "boss": {"bossName": "Lucid", "difficulty": "DIFFICULTY_HARD", "raffleLayerName": "Hard Lucid"}},
                {"layerId": 900001, "contents": {"groupName": "Divine Ascendant", "layerName": "Divine Ascendant"}},
            ]

        def get_character_private(self, asset_key):
            return {"assetKey": asset_key, "walletAddress": "wallet-test-only"}

        def get_character_history(self, _asset_key, _wallet_address, raffled_at):
            return [
                {
                    "raffledAt": raffled_at,
                    "layerId": 205041,
                    "clearInformations": [{"clearedAt": "2026-07-25T11:35:31Z", "partyCount": 1}],
                    "prizes": [{"itemId": 1, "winCount": {"value": "3000000"}}],
                },
                {
                    "raffledAt": raffled_at,
                    "layerId": 900001,
                    "clearInformations": [],
                    "prizes": [
                        {"itemId": 1, "winCount": {"value": "70000000"}},
                        {"itemId": 1000, "winCount": {"value": "55000000"}},
                    ],
                },
            ]

        def get_item_metadata(self, item_id):
            raise AssertionError(f"itemId {item_id} should never be requested from upstream metadata")

    request = CreateJobRequest.model_validate(request_body())
    processor = _live_processor(
        settings(fixture_mode=False),
        StubMsuClient(),
        BoundedTtlCache(max_bytes=1024 * 1024),
        BoundedTtlCache(max_bytes=1024 * 1024),
    )

    result = processor(request, lambda _completed, _stage: None, threading.Event())

    assert result["errors"] == []
    assert result["clears"][0]["members"][0]["powerCrystalAmount"] == "55000000"
    assert result["clears"][0]["members"][0]["ascendantNeso"] == "70000000"

def test_queue_full_returns_retry_after(monkeypatch) -> None:
    with TestClient(create_app(settings())) as client:
        monkeypatch.setattr(client.app.state.job_queue, "create", lambda _payload: None)
        response = client.post("/raffle/v1/jobs", json=request_body())
        assert response.status_code == 429
        assert response.headers["retry-after"] == "5"
        assert response.json()["detail"]["code"] == "queue_full"

def test_job_creation_uses_per_client_burst_limit() -> None:
    with TestClient(create_app(settings())) as client:
        assert client.post("/raffle/v1/jobs", json=request_body()).status_code == 202
        assert client.post("/raffle/v1/jobs", json=request_body()).status_code == 202
        limited = client.post("/raffle/v1/jobs", json=request_body())
        assert limited.status_code == 429
        assert limited.json()["detail"]["code"] == "client_rate_limited"
        assert int(limited.headers["retry-after"]) >= 1

def test_invalid_raffled_at_is_rejected() -> None:
    body = request_body()
    body["raffledAt"] = "2026-99-99T00:00:00Z"
    with TestClient(create_app(settings())) as client:
        assert client.post("/raffle/v1/jobs", json=body).status_code == 422