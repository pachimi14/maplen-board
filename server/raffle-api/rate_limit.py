from __future__ import annotations

import hashlib
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass


@dataclass
class _Bucket:
    tokens: float
    updated_at: float


class TokenBucketLimiter:
    def __init__(self, max_identities: int = 2048) -> None:
        self.max_identities = max(1, max_identities)
        self._lock = threading.Lock()
        self._buckets: OrderedDict[tuple[bytes, str], _Bucket] = OrderedDict()

    @staticmethod
    def anonymize(identity: str) -> bytes:
        return hashlib.sha256(identity.encode("utf-8", "replace")).digest()

    def allow(
        self,
        identity: str,
        scope: str,
        *,
        rate_per_minute: int,
        capacity: int,
        now: float | None = None,
    ) -> tuple[bool, int]:
        current = time.monotonic() if now is None else now
        key = (self.anonymize(identity), scope)
        refill_per_second = rate_per_minute / 60.0
        with self._lock:
            bucket = self._buckets.pop(key, None)
            if bucket is None:
                bucket = _Bucket(tokens=float(capacity), updated_at=current)
            else:
                elapsed = max(0.0, current - bucket.updated_at)
                bucket.tokens = min(float(capacity), bucket.tokens + elapsed * refill_per_second)
                bucket.updated_at = current

            allowed = bucket.tokens >= 1.0
            if allowed:
                bucket.tokens -= 1.0
                retry_after = 0
            else:
                missing = 1.0 - bucket.tokens
                retry_after = max(1, int(missing / refill_per_second + 0.999))
            self._buckets[key] = bucket
            while len(self._buckets) > self.max_identities:
                self._buckets.popitem(last=False)
            return allowed, retry_after