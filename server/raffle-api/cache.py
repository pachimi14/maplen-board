from __future__ import annotations

import json
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass


@dataclass
class CacheEntry:
    value: object
    expires_at: float
    size: int


class BoundedTtlCache:
    def __init__(self, max_bytes: int = 32 * 1024 * 1024) -> None:
        self.max_bytes = max(max_bytes, 1)
        self._entries: OrderedDict[str, CacheEntry] = OrderedDict()
        self._size = 0
        self._lock = threading.Lock()

    def get(self, key: str, now: float | None = None):
        current = time.time() if now is None else now
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            if entry.expires_at <= current:
                self._remove(key)
                return None
            self._entries.move_to_end(key)
            return entry.value

    def set(self, key: str, value, ttl_seconds: float, now: float | None = None) -> bool:
        current = time.time() if now is None else now
        encoded = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        size = len(encoded)
        if size > self.max_bytes or ttl_seconds <= 0:
            return False
        with self._lock:
            self._remove(key)
            self._entries[key] = CacheEntry(value=value, expires_at=current + ttl_seconds, size=size)
            self._size += size
            while self._size > self.max_bytes and self._entries:
                oldest = next(iter(self._entries))
                self._remove(oldest)
        return True

    def _remove(self, key: str) -> None:
        entry = self._entries.pop(key, None)
        if entry is not None:
            self._size -= entry.size