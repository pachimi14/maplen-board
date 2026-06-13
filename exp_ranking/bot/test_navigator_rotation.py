"""Navigator worldId refresh rotation."""

from __future__ import annotations

from datetime import date

from navigator import (
    DEFAULT_ROTATION_EPOCH,
    select_world_sync_keys,
    rotation_target_world,
)


def test_rotation_target_world_cycles_servers() -> None:
    epoch = date(2026, 6, 12)
    assert rotation_target_world(epoch, epoch=epoch) == "Fang"
    assert rotation_target_world(date(2026, 6, 13), epoch=epoch) == "Errai"
    assert rotation_target_world(date(2026, 6, 14), epoch=epoch) == "Ain"
    assert rotation_target_world(date(2026, 6, 15), epoch=epoch) == "Fang"


def test_select_world_sync_keys_includes_missing_and_target_cohort() -> None:
    ref = date(2026, 6, 13)  # Errai day
    existing = {
        "ain-1": "Ain",
        "errai-1": "Errai",
        "errai-2": "Errai",
        "fang-1": "Fang",
    }
    pending, target = select_world_sync_keys(
        ["ain-1", "errai-1", "errai-2", "fang-1", "new-1"],
        existing,
        reference_date=ref,
        epoch=DEFAULT_ROTATION_EPOCH,
    )
    assert target == "Errai"
    assert set(pending) == {"errai-1", "errai-2", "new-1"}


def test_select_world_sync_keys_skips_other_servers() -> None:
    ref = date(2026, 6, 12)  # Fang day
    existing = {"ain-1": "Ain", "fang-1": "Fang"}
    pending, target = select_world_sync_keys(
        ["ain-1", "fang-1"],
        existing,
        reference_date=ref,
        epoch=DEFAULT_ROTATION_EPOCH,
    )
    assert target == "Fang"
    assert pending == ["fang-1"]


if __name__ == "__main__":
    test_rotation_target_world_cycles_servers()
    test_select_world_sync_keys_includes_missing_and_target_cohort()
    test_select_world_sync_keys_skips_other_servers()
    print("ok")
