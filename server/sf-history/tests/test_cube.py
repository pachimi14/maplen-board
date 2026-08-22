from __future__ import annotations

import cube


def test_cube_sub_types_are_exactly_the_four_approved_types() -> None:
    """SH-39 plan §1/§8 accept criterion (a): RED / BLACK / ADDITIONAL /
    WHITE_ADDITIONAL only -- SUSPICIOUS / SUSPICIOUS_ADDITIONAL (Occult
    cubes) must never appear, even though the upstream returns them."""
    assert cube.CUBE_SUB_TYPES == ("RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL")
    assert "SUSPICIOUS" not in cube.CUBE_SUB_TYPES
    assert "SUSPICIOUS_ADDITIONAL" not in cube.CUBE_SUB_TYPES
    assert len(cube.CUBE_SUB_TYPES) == 4
