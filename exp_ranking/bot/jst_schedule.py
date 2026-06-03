"""JST scheduling helpers for post-09:00 ranking fetches."""

from __future__ import annotations

import logging
import time
from datetime import datetime
from zoneinfo import ZoneInfo

JST = ZoneInfo("Asia/Tokyo")

# Ranking day rolls at JST 09:00; fetch after API has the new day.
JST_RESET_HOUR = 9
JST_RESET_MINUTE = 0
JST_FETCH_HOUR = 9
JST_FETCH_MINUTE = 20

MAX_WAIT_SEC = 6 * 60 * 60


def jst_now() -> datetime:
    return datetime.now(JST)


def jst_fetch_window_start(
    reference: datetime | None = None,
    *,
    hour: int = JST_FETCH_HOUR,
    minute: int = JST_FETCH_MINUTE,
) -> datetime:
    current = reference or jst_now()
    if current.tzinfo is None:
        current = current.replace(tzinfo=JST)
    else:
        current = current.astimezone(JST)
    return current.replace(hour=hour, minute=minute, second=0, microsecond=0)


def wait_until_jst_fetch_window(logger: logging.Logger | None = None) -> None:
    """Block until JST 09:20 (ranking reset 09:00 + buffer)."""
    log = logger or logging.getLogger(__name__)
    waited = 0
    while True:
        now = jst_now()
        target = jst_fetch_window_start(now)
        if now >= target:
            if waited:
                log.info(
                    "JST fetch window open (>= %02d:%02d JST, waited %ss)",
                    JST_FETCH_HOUR,
                    JST_FETCH_MINUTE,
                    waited,
                )
            return

        remaining = int((target - now).total_seconds())
        if remaining <= 0:
            return
        if waited >= MAX_WAIT_SEC:
            log.warning(
                "Stopped waiting for JST fetch window after %ss; continuing anyway",
                waited,
            )
            return

        sleep_sec = min(remaining, 60, MAX_WAIT_SEC - waited)
        log.info(
            "Waiting %ss until JST %02d:%02d (now %s JST)",
            sleep_sec,
            JST_FETCH_HOUR,
            JST_FETCH_MINUTE,
            now.strftime("%H:%M:%S"),
        )
        time.sleep(sleep_sec)
        waited += sleep_sec
