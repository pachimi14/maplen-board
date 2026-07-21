"""Regression coverage for job_code -> display-name mapping.

Bug: `JobCode_ANIMA_THIEF4` (Ho Young) had no explicit entry in
`JOB_DISPLAY_BY_BASE`, so `format_job_name` silently fell through to the
generic fallback (underscore -> space + `.title()`), producing
"Anima Thief" instead of "Ho Young". This left Ho Young characters out of
job-based sorting/ranking on the web side, which recognizes "Ho Young" but
not "Anima Thief" (`jobCategories.js`).

`JobCode_DARK_KNIGHT` / `JobCode_BLADE_MASTER` / `JobCode_CANNON_MASTER`
had the same class of gap (no explicit entry) but happened to produce a
correct-looking result purely by luck of the generic fallback's
underscore -> space + `.title()` transform. They are now mapped
explicitly too, and the fixture below asserts every job_code observed in
production resolves via the mapping, not the fallback, so a future gap
in this class is caught even when the fallback's output looks plausible.
"""

from __future__ import annotations

import logging

from job_names import JOB_DISPLAY_BY_BASE, format_job_name, normalize_job_key


def test_anima_thief_resolves_to_ho_young() -> None:
    """The reported bug, pinned individually: JobCode_ANIMA_THIEF4 (as
    returned by the API for Ho Young characters) must map to "Ho Young",
    not fall through to the generic "Anima Thief" fallback."""
    assert format_job_name("JobCode_ANIMA_THIEF4") == "Ho Young"


# All distinct non-empty job_code values observed in production ranking.db
# as of 2026-07-22 (30 codes). Captured via:
#   SELECT DISTINCT job_code FROM ranking_snapshot ORDER BY job_code;
PRODUCTION_JOB_CODES: list[str] = [
    "JobCode_ANIMA_THIEF4",
    "JobCode_ARAN4",
    "JobCode_BISHOP",
    "JobCode_BLADE_MASTER",
    "JobCode_BOWMASTER",
    "JobCode_BUCCANEER",
    "JobCode_CANNON_MASTER",
    "JobCode_CORSAIR",
    "JobCode_DARK_KNIGHT",
    "JobCode_EUNWOL4",
    "JobCode_EVAN9",
    "JobCode_FLAMEWIZARD",
    "JobCode_FP_ARCH_MAGE",
    "JobCode_HERO",
    "JobCode_IL_ARCH_MAGE",
    "JobCode_LEF_PIRATE4",
    "JobCode_LEF_WARRIOR4",
    "JobCode_LUMINOUS4",
    "JobCode_MARKSMAN",
    "JobCode_MERCEDES4",
    "JobCode_MICHAEL",
    "JobCode_NIGHTLORD",
    "JobCode_NIGHTWALKER",
    "JobCode_PALADIN",
    "JobCode_PATHFINDER",
    "JobCode_PHANTOM4",
    "JobCode_SHADOWER",
    "JobCode_SOULEMASTER",
    "JobCode_STRIKER",
    "JobCode_WINDBREAKER",
]

# Expected display name for every production job_code, held fixed as a
# regression guard: the values for the 29 codes untouched by the ANIMA_THIEF
# fix must be byte-identical to pre-fix output (verified separately against
# a decompressed copy of production ranking.db).
EXPECTED_DISPLAY_NAME: dict[str, str] = {
    "JobCode_ANIMA_THIEF4": "Ho Young",  # the bug: was "Anima Thief"
    "JobCode_ARAN4": "Aran",
    "JobCode_BISHOP": "Bishop",
    "JobCode_BLADE_MASTER": "Blade Master",
    "JobCode_BOWMASTER": "Bowmaster",
    "JobCode_BUCCANEER": "Buccaneer",
    "JobCode_CANNON_MASTER": "Cannon Master",
    "JobCode_CORSAIR": "Corsair",
    "JobCode_DARK_KNIGHT": "Dark Knight",
    "JobCode_EUNWOL4": "Shade",
    "JobCode_EVAN9": "Evan",
    "JobCode_FLAMEWIZARD": "Blaze Wizard",
    "JobCode_FP_ARCH_MAGE": "Arch Mage(Fire / Poison)",
    "JobCode_HERO": "Hero",
    "JobCode_IL_ARCH_MAGE": "Arch Mage(Ice / Lightning)",
    "JobCode_LEF_PIRATE4": "Ark",
    "JobCode_LEF_WARRIOR4": "Adele",
    "JobCode_LUMINOUS4": "Luminous",
    "JobCode_MARKSMAN": "Marksman",
    "JobCode_MERCEDES4": "Mercedes",
    "JobCode_MICHAEL": "Mihile",
    "JobCode_NIGHTLORD": "Night Lord",
    "JobCode_NIGHTWALKER": "Night Walker",
    "JobCode_PALADIN": "Paladin",
    "JobCode_PATHFINDER": "Pathfinder",
    "JobCode_PHANTOM4": "Phantom",
    "JobCode_SHADOWER": "Shadower",
    "JobCode_SOULEMASTER": "Dawn Warrior",
    "JobCode_STRIKER": "Thunder Breaker",
    "JobCode_WINDBREAKER": "Wind Archer",
}


def test_all_production_job_codes_resolve_via_mapping_not_fallback() -> None:
    """Every job_code seen in production must hit JOB_DISPLAY_BY_BASE.

    If this fails for some code, format_job_name() is silently relying on
    the generic fallback for it, which is exactly the class of bug this
    test guards against (it happened to look right for Dark Knight / Blade
    Master / Cannon Master, and looked wrong for Ho Young / Anima Thief).
    """
    unmapped = [
        code
        for code in PRODUCTION_JOB_CODES
        if normalize_job_key(code) not in JOB_DISPLAY_BY_BASE
    ]
    assert unmapped == [], f"job_codes falling through to fallback: {unmapped}"


def test_all_production_job_codes_produce_expected_display_name() -> None:
    """Fixed regression values for all 30 production job_codes (29 unchanged
    + JobCode_ANIMA_THIEF4 fixed from 'Anima Thief' to 'Ho Young')."""
    for code in PRODUCTION_JOB_CODES:
        assert format_job_name(code) == EXPECTED_DISPLAY_NAME[code], code


def test_unmapped_job_code_still_falls_back_but_logs_a_warning(caplog) -> None:
    """Unknown/future job_codes keep working (fallback preserved) but now
    emit a logger.warning so a newly-introduced API job_code surfaces in CI
    logs instead of silently mis-classifying a job again."""
    with caplog.at_level(logging.WARNING, logger="job_names"):
        result = format_job_name("JobCode_TOTALLY_NEW_JOB9")
    assert result == "Totally New Job"
    assert any("Unmapped job_code" in record.message for record in caplog.records)


def test_known_job_code_does_not_log_a_warning(caplog) -> None:
    """Mapped codes must not spam the warning log."""
    with caplog.at_level(logging.WARNING, logger="job_names"):
        format_job_name("JobCode_HERO")
    assert caplog.records == []
