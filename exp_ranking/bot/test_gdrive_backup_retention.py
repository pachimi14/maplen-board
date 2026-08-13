"""Unit tests for gdrive_backup_retention.py (T12 P5.5, commit3).

Pure planning logic -- no Drive API/network involved. Covers the §2.4
safety guards explicitly: 8-day age boundary, same-day dedup, and the
minimum-keep floor that blocks deletion entirely when it would be violated.
"""

from __future__ import annotations

from datetime import datetime, timezone

import gdrive_backup_retention as retention


def _entry(date: str, time: str, run_id: str, file_id: str | None = None) -> retention.BackupEntry:
    return retention.BackupEntry(
        file_id=file_id or f"{date}-{time}-{run_id}",
        name=f"ranking-db-{date}T{time}Z-run-{run_id}.db.gz",
        date=date,
        time=time,
        run_id=run_id,
    )


NOW = datetime(2026, 8, 10, 9, 5, 0, tzinfo=timezone.utc)  # "today" = 2026-08-10


# ---------------------------------------------------------------------------
# parse_entry
# ---------------------------------------------------------------------------


def test_parse_entry_builds_backup_entry_from_matching_filename():
    entry = retention.parse_entry(
        {"id": "file-1", "name": "ranking-db-2026-07-29T090500Z-run-123.db.gz"}
    )
    assert entry == retention.BackupEntry(
        file_id="file-1", name="ranking-db-2026-07-29T090500Z-run-123.db.gz",
        date="2026-07-29", time="090500", run_id="123",
    )


def test_parse_entry_returns_none_for_non_matching_name():
    assert retention.parse_entry({"id": "file-1", "name": "not-a-backup.txt"}) is None


def test_parse_entry_returns_none_when_id_missing():
    assert retention.parse_entry({"name": "ranking-db-2026-07-29T090500Z-run-123.db.gz"}) is None


# ---------------------------------------------------------------------------
# age boundary (§2.4: "8日以上前のみ削除")
# ---------------------------------------------------------------------------


def test_entry_exactly_7_days_old_is_kept():
    # today=2026-08-10, entry date=2026-08-03 -> age_days=7 -> must NOT delete
    old = _entry("2026-08-03", "090000", "1")
    new = _entry("2026-08-10", "090500", "2")
    plan = retention.plan_retention([old], new, now_utc=NOW)
    assert plan.warning is None
    assert old in plan.keep
    assert old not in plan.delete


def test_entry_exactly_8_days_old_is_deleted():
    # today=2026-08-10, entry date=2026-08-02 -> age_days=8 -> delete candidate.
    # A recent filler entry is included so the min_keep(2) floor doesn't
    # itself block the deletion this test is exercising (see the dedicated
    # min-keep-guard tests below for that behaviour in isolation).
    old = _entry("2026-08-02", "090000", "1")
    recent_filler = _entry("2026-08-09", "090000", "9")
    new = _entry("2026-08-10", "090500", "2")
    plan = retention.plan_retention([old, recent_filler], new, now_utc=NOW)
    assert plan.warning is None
    assert old in plan.delete
    assert old not in plan.keep


def test_entry_far_in_the_past_is_deleted():
    ancient = _entry("2025-01-01", "090000", "1")
    recent_filler = _entry("2026-08-09", "090000", "9")
    new = _entry("2026-08-10", "090500", "2")
    plan = retention.plan_retention([ancient, recent_filler], new, now_utc=NOW)
    assert ancient in plan.delete


def test_todays_new_entry_is_never_deleted_on_age_grounds():
    new = _entry("2026-08-10", "090500", "2")
    plan = retention.plan_retention([], new, now_utc=NOW)
    assert plan.delete == []
    assert new in plan.keep


# ---------------------------------------------------------------------------
# same-day dedup (§2.3: "同日中に複数成功した場合は最新の成功分だけを残す")
# ---------------------------------------------------------------------------


def test_same_day_duplicates_keep_only_newest_by_time():
    earlier_today = _entry("2026-08-10", "090500", "100")  # pages run
    recent_filler = _entry("2026-08-09", "090000", "9")
    later_today = _entry("2026-08-10", "150000", "200")  # navigator run, same day
    plan = retention.plan_retention([earlier_today, recent_filler], later_today, now_utc=NOW)

    assert plan.warning is None
    assert set(plan.keep) == {later_today, recent_filler}
    assert plan.delete == [earlier_today]


def test_same_day_dedup_applies_regardless_of_age():
    """Two entries sharing a UTC date that is itself old (< 8 days threshold
    not yet reached) should still collapse to one -- §2.3's "1 UTC日あたり
    1世代" is not gated on the age-deletion threshold."""
    older_same_day = _entry("2026-08-09", "090000", "1")  # age=1, not delete-by-age
    newer_same_day = _entry("2026-08-09", "150000", "2")  # age=1, not delete-by-age
    new_today = _entry("2026-08-10", "090500", "3")

    plan = retention.plan_retention([older_same_day, newer_same_day], new_today, now_utc=NOW)

    assert older_same_day in plan.delete
    assert newer_same_day in plan.keep
    assert new_today in plan.keep


def test_old_same_day_duplicate_beyond_age_threshold_is_also_deleted():
    old1 = _entry("2026-08-01", "090000", "1")  # age=9, both candidates
    old2 = _entry("2026-08-01", "150000", "2")  # age=9
    recent_filler = _entry("2026-08-09", "090000", "9")
    new_today = _entry("2026-08-10", "090500", "3")

    plan = retention.plan_retention([old1, old2, recent_filler], new_today, now_utc=NOW)

    assert old1 in plan.delete
    assert old2 in plan.delete
    assert set(plan.keep) == {new_today, recent_filler}


# ---------------------------------------------------------------------------
# minimum-keep guard (§2.4: "新規世代 + 直前の正常世代" 以上を残す)
# ---------------------------------------------------------------------------


def test_deletion_blocked_when_it_would_drop_below_min_keep():
    # Only one existing generation, and it's old enough to be deletable.
    # Deleting it would leave just the brand-new one (1 total) < min_keep(2).
    only_old = _entry("2026-01-01", "090000", "1")
    new_today = _entry("2026-08-10", "090500", "2")

    plan = retention.plan_retention([only_old], new_today, now_utc=NOW, min_keep=2)

    assert plan.delete == []
    assert plan.warning is not None
    assert "2件" in plan.warning or "2" in plan.warning
    # Nothing is force-deleted -- even the "old" entry is preserved.
    assert only_old in plan.keep
    assert new_today in plan.keep


def test_deletion_proceeds_when_two_generations_would_remain():
    old1 = _entry("2026-01-01", "090000", "1")  # deletable by age
    recent = _entry("2026-08-09", "090000", "2")  # kept (age=1)
    new_today = _entry("2026-08-10", "090500", "3")

    plan = retention.plan_retention([old1, recent], new_today, now_utc=NOW, min_keep=2)

    assert plan.warning is None
    assert old1 in plan.delete
    assert set(plan.keep) == {recent, new_today}


def test_min_keep_guard_evaluates_after_dedup_and_age_together():
    """Both same-day dedup and age-based deletion combine into one delete
    set; the min_keep check must run against the *combined* result, not
    each rule independently (otherwise a plan could pass each rule alone
    but still under-shoot min_keep overall)."""
    dup_a = _entry("2026-08-01", "090000", "1")  # same day as dup_b, also old
    dup_b = _entry("2026-08-01", "150000", "2")  # newest of that day, but still old (age=9)
    new_today = _entry("2026-08-10", "090500", "3")

    plan = retention.plan_retention([dup_a, dup_b], new_today, now_utc=NOW, min_keep=2)

    # dup_a is removed by dedup; dup_b (the dedup survivor) is still >=8
    # days old so it is removed too -- only new_today would remain (1 total)
    # which is below min_keep(2), so nothing is deleted at all.
    assert plan.delete == []
    assert plan.warning is not None
