"""Regression coverage for job_code -> display-name mapping.

Bug: `JobCode_ANIMA_THIEF4` (Ho Young) had no explicit entry in
`JOB_DISPLAY_BY_BASE`, so `format_job_name` silently fell through to the
generic fallback (underscore -> space + `.title()`), producing
"Anima Thief" instead of "Ho Young". This left Ho Young characters out of
job-based sorting/ranking on the web side, which recognizes "Ho Young" but
not "Anima Thief" (`jobCategories.js`).
"""

from __future__ import annotations

from job_names import format_job_name


def test_anima_thief_resolves_to_ho_young() -> None:
    """The reported bug, pinned individually: JobCode_ANIMA_THIEF4 (as
    returned by the API for Ho Young characters) must map to "Ho Young",
    not fall through to the generic "Anima Thief" fallback."""
    assert format_job_name("JobCode_ANIMA_THIEF4") == "Ho Young"
