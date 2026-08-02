from __future__ import annotations

from rate_limit import TokenBucketLimiter


def test_token_bucket_enforces_burst_and_refills() -> None:
    limiter = TokenBucketLimiter()
    assert limiter.allow("client-a", "jobs", rate_per_minute=4, capacity=2, now=0)[0]
    assert limiter.allow("client-a", "jobs", rate_per_minute=4, capacity=2, now=0)[0]
    allowed, retry_after = limiter.allow(
        "client-a", "jobs", rate_per_minute=4, capacity=2, now=0
    )
    assert not allowed
    assert retry_after == 15
    assert limiter.allow("client-a", "jobs", rate_per_minute=4, capacity=2, now=15)[0]


def test_scopes_and_identities_are_independent() -> None:
    limiter = TokenBucketLimiter()
    assert limiter.allow("client-a", "jobs", rate_per_minute=1, capacity=1, now=0)[0]
    assert limiter.allow("client-a", "poll", rate_per_minute=1, capacity=1, now=0)[0]
    assert limiter.allow("client-b", "jobs", rate_per_minute=1, capacity=1, now=0)[0]