"""Tests for one-time ranking-day label migration."""

from __future__ import annotations

from ranking_day import shift_mvp_json_dates


def test_shift_mvp_json_dates() -> None:
    payload = {
        "meta": {
            "latestSnapshotDate": "2026-06-02",
            "gainPeriods": {
                "daily": {"periodStart": "2026-06-02", "periodEnd": "2026-06-02"},
            },
        },
        "characters": [
            {
                "history": [
                    {"date": "06/02", "snapshotDate": "2026-06-02"},
                ]
            }
        ],
    }
    shifted = shift_mvp_json_dates(payload, days=-1)
    assert shifted["meta"]["latestSnapshotDate"] == "2026-06-01"
    point = shifted["characters"][0]["history"][0]
    assert point["snapshotDate"] == "2026-06-01"
    assert point["date"] == "06/01"


if __name__ == "__main__":
    test_shift_mvp_json_dates()
    print("ok")
