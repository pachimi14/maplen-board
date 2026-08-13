from __future__ import annotations

import ipaddress
import os
import sqlite3
import time
from decimal import Decimal, InvalidOperation
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from cache import BoundedTtlCache
from config import Settings, load_settings
from contracts import CharacterSearchRequest, CreateJobRequest, ResolveCharacterRequest
from item_metadata_store import ItemMetadataStore
from job_queue import JobQueue
from msu_client import DailyBudgetExceeded, GlobalStartLimiter, MsuClient, UpstreamError
from normalizer import SCHEMA_VERSION, fixture_result, normalize_live_history
from rate_limit import TokenBucketLimiter


ITEM_MEMORY_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60


def _request_identity(request: Request) -> str:
    peer = request.client.host if request.client else "unknown"
    if peer in {"127.0.0.1", "::1"}:
        candidate = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
        try:
            if candidate:
                ipaddress.ip_address(candidate)
                peer = candidate
        except ValueError:
            pass
    return peer[:128]

def _fixture_processor(settings: Settings):
    def process(request: CreateJobRequest, update, cancel_event):
        for index, _character in enumerate(request.characters):
            if cancel_event.is_set():
                return {"clears": [], "warnings": [], "errors": []}
            update(index, "fetching")
            time.sleep(settings.fixture_delay_ms / 1000)
            update(index + 1, "fetching")
        update(len(request.characters), "normalizing")
        return fixture_result(request)

    return process


def _positive_prize_item_ids(histories: list[dict], raffled_at: str) -> set[int]:
    item_ids: set[int] = set()
    for history in histories:
        if not isinstance(history, dict) or history.get("raffledAt") != raffled_at:
            continue
        prizes = history.get("prizes")
        if not isinstance(prizes, list):
            continue
        for prize in prizes:
            if not isinstance(prize, dict):
                continue
            reward_key = prize.get("rewardKey") if isinstance(prize.get("rewardKey"), dict) else {}
            item_id = prize.get("itemId", reward_key.get("itemId"))
            win_count = prize.get("winCount")
            if isinstance(win_count, dict):
                win_count = win_count.get("value")
            try:
                quantity = Decimal(str(win_count))
                normalized_item_id = int(item_id)
            except (InvalidOperation, TypeError, ValueError):
                continue
            if quantity.is_finite() and quantity > 0 and quantity == quantity.to_integral_value() and normalized_item_id > 1:
                item_ids.add(normalized_item_id)
    return item_ids


def _live_processor(settings: Settings, client: MsuClient, layer_cache: BoundedTtlCache, item_cache: BoundedTtlCache, item_metadata_store: ItemMetadataStore | None = None):
    def process(request: CreateJobRequest, update, cancel_event):
        started_at = time.monotonic()
        histories_by_member: dict[str, list[dict]] = {}
        member_wallets: dict[str, str] = {}
        errors: list[dict] = []
        item_metadata: dict[int, dict] = {}
        attempted_item_ids: set[int] = set()
        metadata_external_stopped = False

        def hydrate_item_metadata(histories: list[dict]) -> None:
            nonlocal metadata_external_stopped
            for item_id in sorted(_positive_prize_item_ids(histories, request.raffledAt)):
                if item_id in item_metadata or item_id in attempted_item_ids:
                    continue
                cached = item_cache.get(str(item_id))
                if isinstance(cached, dict):
                    item_metadata[item_id] = cached
                    continue
                if item_metadata_store is not None:
                    persisted = item_metadata_store.load(item_id)
                    if persisted is not None:
                        metadata, remaining_ttl = persisted
                        item_metadata[item_id] = metadata
                        item_cache.set(
                            str(item_id),
                            metadata,
                            ttl_seconds=min(ITEM_MEMORY_CACHE_TTL_SECONDS, remaining_ttl),
                        )
                        continue
                if metadata_external_stopped:
                    continue
                if time.monotonic() - started_at >= settings.hard_timeout_seconds:
                    errors.append({"code": "metadata_timeout"})
                    metadata_external_stopped = True
                    continue
                attempted_item_ids.add(item_id)
                try:
                    metadata = client.get_item_metadata(item_id)
                    item_metadata[item_id] = metadata
                    item_cache.set(str(item_id), metadata, ttl_seconds=ITEM_MEMORY_CACHE_TTL_SECONDS)
                    if item_metadata_store is not None:
                        item_metadata_store.save(item_id, metadata)
                except DailyBudgetExceeded:
                    errors.append({"code": "upstream_daily_budget_exceeded"})
                    metadata_external_stopped = True
                except UpstreamError:
                    errors.append({"code": "item_metadata_unavailable", "itemId": item_id})

        layers = layer_cache.get("layers")
        if not isinstance(layers, list):
            layers = client.get_layers_static()
            layer_cache.set("layers", layers, ttl_seconds=24 * 60 * 60)

        for index, character in enumerate(request.characters):
            if cancel_event.is_set():
                return {"raffleResults": [], "clears": [], "warnings": [], "errors": [], "memberWallets": {}}
            update(index, "fetching")
            try:
                resolved = client.get_character_private(character.assetKey)
                wallet_address = character.walletOverride or resolved.get("walletAddress", "")
                if not wallet_address:
                    errors.append({"code": "wallet_not_available", "memberId": character.memberId})
                else:
                    # Record the resolved owner wallet regardless of whether the
                    # subsequent history fetch below succeeds: the wallet itself
                    # was resolved, and transfer notifications (LULU-103) need it
                    # even if this member's raffle history could not be fetched.
                    member_wallets[character.memberId] = wallet_address
                    member_histories = client.get_character_history(
                        character.assetKey, wallet_address, request.raffledAt
                    )
                    histories_by_member[character.memberId] = member_histories
                    hydrate_item_metadata(member_histories)
            except DailyBudgetExceeded:
                errors.append({"code": "upstream_daily_budget_exceeded", "memberId": character.memberId})
            except UpstreamError:
                errors.append({"code": "history_unavailable", "memberId": character.memberId})
            update(index + 1, "fetching")

        update(len(request.characters), "normalizing")
        result = normalize_live_history(
            request, histories_by_member, layers, item_metadata, initial_errors=errors
        )
        # memberWallets carries each requested member's own owner wallet
        # (wallet override wins) so the web client can render/copy transfer
        # notifications. Never logged, never cached (job results only live in
        # the in-memory job queue for job_ttl_seconds).
        result["memberWallets"] = member_wallets
        return result

    return process

def create_app(
    settings: Settings | None = None,
    upstream_client: MsuClient | None = None,
) -> FastAPI:
    config = settings or load_settings()
    rate_limiter = TokenBucketLimiter()
    msu_client = upstream_client or MsuClient(
        api_key=os.getenv("MSU_OPEN_API_KEY", ""),
        limiter=GlobalStartLimiter(
            interval_seconds=config.upstream_start_interval_ms / 1000,
            daily_budget=config.daily_upstream_budget,
        ),
    )
    character_cache = BoundedTtlCache(max_bytes=1024 * 1024)
    layer_cache = BoundedTtlCache(max_bytes=2 * 1024 * 1024)
    item_cache = BoundedTtlCache(max_bytes=4 * 1024 * 1024)
    item_metadata_store = None
    if not config.fixture_mode and config.item_cache_db_path:
        try:
            item_metadata_store = ItemMetadataStore(
                config.item_cache_db_path,
                ttl_seconds=config.item_cache_ttl_seconds,
            )
        except (OSError, sqlite3.Error, ValueError):
            item_metadata_store = None
    processor = _fixture_processor(config) if config.fixture_mode else _live_processor(
        config,
        msu_client,
        layer_cache,
        item_cache,
        item_metadata_store,
    )
    job_queue = JobQueue(
        processor,
        capacity=config.queue_capacity,
        completed_capacity=config.completed_capacity,
        ttl_seconds=config.job_ttl_seconds,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        job_queue.close()

    app = FastAPI(
        title="Lulumi Tools raffle API",
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.settings = config
    app.state.job_queue = job_queue
    app.state.rate_limiter = rate_limiter
    app.state.msu_client = msu_client
    app.state.character_cache = character_cache
    app.state.item_metadata_store = item_metadata_store

    def enforce_rate(
        request: Request,
        scope: str,
        *,
        rate_per_minute: int,
        capacity: int,
    ) -> None:
        allowed, retry_after = rate_limiter.allow(
            _request_identity(request),
            scope,
            rate_per_minute=rate_per_minute,
            capacity=capacity,
        )
        if not allowed:
            raise HTTPException(
                status_code=429,
                detail={"code": "client_rate_limited"},
                headers={"Retry-After": str(retry_after)},
            )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Accept", "Content-Type"],
        max_age=600,
    )

    @app.get("/raffle/v1/health")
    def health() -> dict:
        return {
            "status": "ok",
            "fixtureMode": config.fixture_mode,
            "schemaVersion": SCHEMA_VERSION,
            "persistentItemCache": item_metadata_store is not None,
        }

    def normalized_character_response(character: dict, member_id: str | None = None) -> dict:
        response = {
            "schemaVersion": SCHEMA_VERSION,
            "displayName": character["displayName"],
            "level": character.get("level"),
            "jobName": character.get("jobName", ""),
            "worldId": character.get("worldId", ""),
            "imageUrl": character.get("imageUrl", ""),
        }
        if member_id is not None:
            response["memberId"] = member_id
            return {"schemaVersion": SCHEMA_VERSION, **response}
        response["assetKey"] = character["assetKey"]
        return response

    def fixture_character(query: str) -> dict | None:
        fixtures = {
            "pachimi": {
                "assetKey": "CHARfixture001",
                "displayName": "pachimi",
                "level": 253,
                "jobName": "Evan",
                "worldId": "fixture-world",
                "imageUrl": "",
            },
            "0kn0": {
                "assetKey": "CHARfixture002",
                "displayName": "0kn0",
                "level": 247,
                "jobName": "Corsair",
                "worldId": "fixture-world",
                "imageUrl": "",
            },
        }
        return fixtures.get(query.casefold())

    def handle_upstream_error(exc: UpstreamError) -> None:
        if isinstance(exc, DailyBudgetExceeded):
            raise HTTPException(
                status_code=429,
                detail={"code": "upstream_daily_budget_exceeded"},
                headers={"Retry-After": "3600"},
            ) from exc
        raise HTTPException(status_code=502, detail={"code": "upstream_unavailable"}) from exc

    @app.post("/raffle/v1/characters/search")
    def search_character(payload: CharacterSearchRequest, request: Request) -> dict:
        enforce_rate(request, "character-search", rate_per_minute=10, capacity=5)
        cache_key = "character-search:" + payload.query.casefold()
        cached = character_cache.get(cache_key)
        if isinstance(cached, dict):
            return cached
        if config.fixture_mode:
            character = fixture_character(payload.query)
        else:
            if not msu_client.api_key:
                raise HTTPException(status_code=503, detail={"code": "api_key_not_configured"})
            try:
                character = msu_client.search_character(payload.query)
            except UpstreamError as exc:
                handle_upstream_error(exc)
        response = {
            "schemaVersion": SCHEMA_VERSION,
            "query": payload.query,
            "results": [normalized_character_response(character)] if character else [],
        }
        character_cache.set(cache_key, response, ttl_seconds=300 if character else 30)
        return response

    @app.post("/raffle/v1/characters/resolve")
    def resolve_character(payload: ResolveCharacterRequest, request: Request) -> dict:
        enforce_rate(request, "resolve", rate_per_minute=10, capacity=5)
        if config.fixture_mode:
            fixture = fixture_character("pachimi") or {}
            character = {
                **fixture,
                "assetKey": payload.assetKey,
                "displayName": "Fixture " + payload.memberId,
            }
        else:
            if not msu_client.api_key:
                raise HTTPException(status_code=503, detail={"code": "api_key_not_configured"})
            try:
                character = msu_client.get_character(payload.assetKey)
            except UpstreamError as exc:
                handle_upstream_error(exc)
        return normalized_character_response(character, member_id=payload.memberId)


    @app.post("/raffle/v1/jobs", status_code=202)
    def create_job(payload: CreateJobRequest, request: Request) -> dict:
        enforce_rate(request, "jobs", rate_per_minute=4, capacity=2)
        if int(request.headers.get("content-length", "0") or "0") > 16 * 1024:
            raise HTTPException(status_code=413, detail={"code": "body_too_large"})
        if not config.fixture_mode and not msu_client.api_key:
            raise HTTPException(status_code=503, detail={"code": "api_key_not_configured"})
        job_id = job_queue.create(payload)
        if job_id is None:
            raise HTTPException(
                status_code=429,
                detail={"code": "queue_full"},
                headers={"Retry-After": "5"},
            )
        return {"jobId": job_id, "schemaVersion": SCHEMA_VERSION}

    @app.get("/raffle/v1/jobs/{job_id}")
    def get_job(job_id: str, request: Request) -> dict:
        enforce_rate(request, "poll", rate_per_minute=180, capacity=180)
        if len(job_id) > 128:
            raise HTTPException(status_code=404, detail={"code": "job_not_found"})
        payload = job_queue.get(job_id)
        if payload is None:
            raise HTTPException(status_code=404, detail={"code": "job_not_found"})
        return payload

    @app.delete("/raffle/v1/jobs/{job_id}", status_code=204)
    def cancel_job(job_id: str, request: Request) -> Response:
        enforce_rate(request, "poll", rate_per_minute=180, capacity=180)
        if not job_queue.cancel(job_id):
            raise HTTPException(status_code=404, detail={"code": "job_not_found"})
        return Response(status_code=204)

    return app


app = create_app()