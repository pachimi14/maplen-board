from __future__ import annotations

from cache import BoundedTtlCache


def test_cache_expires_and_evicts() -> None:
    cache = BoundedTtlCache(max_bytes=30)
    assert cache.set("a", {"value": "12345"}, ttl_seconds=10, now=0)
    assert cache.get("a", now=5) == {"value": "12345"}
    assert cache.get("a", now=11) is None

    assert cache.set("b", {"value": "12345"}, ttl_seconds=10, now=0)
    assert cache.set("c", {"value": "67890"}, ttl_seconds=10, now=0)
    assert cache.get("c", now=1) == {"value": "67890"}