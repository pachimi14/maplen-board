"""JST gain aggregation periods (aligned with ranking-day snapshots)."""

from __future__ import annotations

from datetime import date, timedelta

JST = "Asia/Tokyo"

# Ranking day id = UTC gain day (fetch UTC date - 1; game reset UTC 00:00 / JST 09:00).
DAILY_RESET = "毎日 9:00 JST"
WEEKLY_RESET = "毎週木曜 9:00 JST"
MONTHLY_RESET = "毎月1日 9:00 JST"


def weekly_period_start(latest_ranking_day: date) -> date:
    """Start of the current weekly period (inclusive), Thursday 09:00 JST."""
    days_since_thursday = (latest_ranking_day.weekday() - 3) % 7
    return latest_ranking_day - timedelta(days=days_since_thursday)


def monthly_period_start(latest_ranking_day: date) -> date:
    """Start of the current monthly period (inclusive), 1st 09:00 JST."""
    return latest_ranking_day.replace(day=1)


def sum_daily_gains_in_period(
    daily_by_date: list[tuple[str, int | None]],
    *,
    period_start: date,
    period_end: date,
) -> int:
    total = 0
    for snapshot_date, gain in daily_by_date:
        try:
            ranking_day = date.fromisoformat(snapshot_date)
        except ValueError:
            continue
        if period_start <= ranking_day <= period_end and gain is not None:
            total += gain
    return total


def gain_period_meta(latest_ranking_day: date) -> dict[str, object]:
    week_start = weekly_period_start(latest_ranking_day)
    month_start = monthly_period_start(latest_ranking_day)
    return {
        "timezone": JST,
        "daily": {
            "resetsAt": DAILY_RESET,
            "periodStart": latest_ranking_day.isoformat(),
            "periodEnd": latest_ranking_day.isoformat(),
        },
        "weekly": {
            "resetsAt": WEEKLY_RESET,
            "periodStart": week_start.isoformat(),
            "periodEnd": latest_ranking_day.isoformat(),
        },
        "monthly": {
            "resetsAt": MONTHLY_RESET,
            "periodStart": month_start.isoformat(),
            "periodEnd": latest_ranking_day.isoformat(),
        },
    }
