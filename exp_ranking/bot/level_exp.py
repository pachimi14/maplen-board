"""Level-up EXP table and calculations for MSU ranking."""

from __future__ import annotations

# MSU: EXP required to reach the next level (Lv225-Lv274)
_EXP_TO_NEXT_LEVEL: dict[int, int] = {
    225: 314_754_893_173,
    226: 327_345_088_899,
    227: 340_438_892_454,
    228: 354_056_448_150,
    229: 368_218_706_074,
    230: 751_166_160_390,
    231: 766_189_483_595,
    232: 781_513_273_265,
    233: 797_143_538_730,
    234: 813_086_409_503,
    235: 829_348_137_691,
    236: 845_935_100_443,
    237: 862_853_802_451,
    238: 880_110_878_499,
    239: 897_713_096_067,
    240: 1_813_380_454_053,
    241: 1_831_514_258_591,
    242: 1_849_829_401_175,
    243: 1_868_327_695_184,
    244: 1_887_010_972_134,
    245: 1_905_881_081_854,
    246: 1_924_939_892_669,
    247: 1_944_189_291_594,
    248: 1_963_631_184_509,
    249: 1_983_267_496_351,
    250: 4_006_200_342_629,
    251: 4_046_262_346_055,
    252: 4_086_724_969_515,
    253: 4_127_592_219_210,
    254: 4_168_868_141_402,
    255: 4_210_556_822_816,
    256: 4_252_662_391_044,
    257: 4_295_189_014_954,
    258: 4_338_140_905_103,
    259: 4_381_522_314_154,
    260: 8_850_675_074_591,
    261: 8_939_181_825_336,
    262: 9_028_573_643_589,
    263: 9_118_859_380_024,
    264: 9_210_047_973_824,
    265: 9_302_148_453_562,
    266: 9_395_169_938_097,
    267: 9_489_121_637_477,
    268: 9_584_012_853_851,
    269: 9_679_852_982_389,
    270: 19_553_303_024_425,
    271: 19_748_836_054_669,
    272: 19_946_324_415_215,
    273: 20_145_787_659_367,
    274: 20_347_245_535_960,
}

EXP_TO_NEXT_LEVEL: dict[int, int] = dict(_EXP_TO_NEXT_LEVEL)

TABLE_MIN_LEVEL = 225
TABLE_MAX_LEVEL = 274
LEVEL_CAP = 275
MILESTONE_LEVEL_250 = 250
# Backward-compatible alias
MAX_RANKING_LEVEL = LEVEL_CAP

MIN_RANKING_LEVEL = TABLE_MIN_LEVEL

TARGET_TOTAL_EXP_250: int = sum(
    EXP_TO_NEXT_LEVEL[level] for level in range(240, MILESTONE_LEVEL_250)
)

TARGET_TOTAL_EXP_275: int = sum(
    EXP_TO_NEXT_LEVEL[level] for level in range(240, LEVEL_CAP)
)

TOTAL_EXP_225_TO_250: int = sum(
    EXP_TO_NEXT_LEVEL[level] for level in range(TABLE_MIN_LEVEL, MILESTONE_LEVEL_250)
)


def exp_required_for_level(level: int) -> int | None:
    if level >= LEVEL_CAP:
        return None
    return EXP_TO_NEXT_LEVEL.get(level)


def calculate_level_exp_percent(level: int, exp: int) -> float:
    """Progress within the current level (0-100), matching in-game ranking display."""
    if level >= LEVEL_CAP:
        return 100.0

    required = exp_required_for_level(level)
    if not required or required <= 0:
        return 0.0

    percent = exp / required * 100.0
    return round(min(max(percent, 0.0), 100.0), 3)


def _calculate_exp_to_target(level: int, exp: int, target_level: int) -> int:
    if level >= target_level:
        return 0

    required_current = exp_required_for_level(level)
    if required_current is None:
        return 0

    remaining = max(required_current - exp, 0)
    for lv in range(level + 1, target_level):
        remaining += EXP_TO_NEXT_LEVEL.get(lv, 0)
    return remaining


def calculate_exp_to_250(level: int, exp: int) -> int:
    return _calculate_exp_to_target(level, exp, MILESTONE_LEVEL_250)


def calculate_exp_to_275(level: int, exp: int) -> int:
    return _calculate_exp_to_target(level, exp, LEVEL_CAP)


def calculate_total_exp_from_240(level: int, exp: int) -> int:
    """Cumulative EXP from Lv240 start (for 240+ daily gain / analysis)."""
    if level >= MILESTONE_LEVEL_250:
        return TARGET_TOTAL_EXP_250
    if level < 240:
        return 0

    total = exp
    for lv in range(240, level):
        total += EXP_TO_NEXT_LEVEL[lv]
    return total


def calculate_progress_toward_250(level: int, exp: int) -> int:
    """Monotonic progress value toward Lv250 (daily gain for all ranked levels)."""
    if level >= MILESTONE_LEVEL_250:
        return TOTAL_EXP_225_TO_250
    if level < TABLE_MIN_LEVEL:
        return 0
    return TOTAL_EXP_225_TO_250 - calculate_exp_to_250(level, exp)


def calculate_exp_percent(level: int, exp: int) -> float:
    return calculate_level_exp_percent(level, exp)
