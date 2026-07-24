"""Navigator duplicate-run guard."""

from __future__ import annotations

from datetime import date

from main import (
    navigator_success_matches,
    navigator_success_payload,
    should_store_navigator_success_marker,
)


def test_navigator_success_matches_same_run_target_and_snapshot() -> None:
    raw = navigator_success_payload(
        run_date=date(2026, 7, 23),
        target_world="Ain",
        snapshot_date="2026-07-22",
    )

    assert navigator_success_matches(
        raw,
        run_date=date(2026, 7, 23),
        target_world="Ain",
        snapshot_date="2026-07-22",
    )


def test_navigator_success_does_not_match_different_snapshot() -> None:
    raw = navigator_success_payload(
        run_date=date(2026, 7, 23),
        target_world="Ain",
        snapshot_date="2026-07-22",
    )

    assert not navigator_success_matches(
        raw,
        run_date=date(2026, 7, 23),
        target_world="Ain",
        snapshot_date="2026-07-23",
    )


def test_navigator_success_ignores_invalid_payload() -> None:
    assert not navigator_success_matches(
        "not-json",
        run_date=date(2026, 7, 23),
        target_world="Ain",
        snapshot_date="2026-07-22",
    )


def test_navigator_success_marker_not_stored_when_sync_failed() -> None:
    assert not should_store_navigator_success_marker(
        rotation_enabled=True,
        snapshot_date="2026-07-22",
        failed_count=1,
    )


def test_navigator_success_marker_stored_after_successful_sync() -> None:
    assert should_store_navigator_success_marker(
        rotation_enabled=True,
        snapshot_date="2026-07-22",
        failed_count=0,
    )
