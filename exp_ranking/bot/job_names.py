"""Map MSU API job codes to display names."""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

# Base job id (without advancement tier suffix) → display name
JOB_DISPLAY_BY_BASE: dict[str, str] = {
    "HERO": "Hero",
    "PALADIN": "Paladin",
    "DARKKNIGHT": "Dark Knight",
    "DARK_KNIGHT": "Dark Knight",
    "FIREPOISON": "Arch Mage(Fire / Poison)",
    "FP_ARCH_MAGE": "Arch Mage(Fire / Poison)",
    "ICELIGHTNING": "Arch Mage(Ice / Lightning)",
    "IL_ARCH_MAGE": "Arch Mage(Ice / Lightning)",
    "BISHOP": "Bishop",
    "BOWMASTER": "Bowmaster",
    "MARKSMAN": "Marksman",
    "PATHFINDER": "Pathfinder",
    "NIGHTLORD": "Night Lord",
    "SHADOWER": "Shadower",
    "BLADEMASTER": "Blade Master",
    "BLADE_MASTER": "Blade Master",
    "SOULEMASTER": "Dawn Warrior",
    "CORSAIR": "Corsair",
    "BUCCANEER": "Buccaneer",
    "CANNONMASTER": "Cannon Master",
    "CANNONSHOOTER": "Cannon Master",
    "CANNON_MASTER": "Cannon Master",
    "EUNWOL": "Shade",
    "EVAN": "Evan",
    "ARAN": "Aran",
    "LUMINOUS": "Luminous",
    "MERCEDES": "Mercedes",
    "PHANTOM": "Phantom",
    "DAWNWARRIOR": "Dawn Warrior",
    "BLAZEWIZARD": "Blaze Wizard",
    "FLAMEWIZARD": "Blaze Wizard",
    "WINDARCHER": "Wind Archer",
    "WINDBREAKER": "Wind Archer",
    "NIGHTWALKER": "Night Walker",
    "THUNDERBREAKER": "Thunder Breaker",
    "STRIKER": "Thunder Breaker",
    "MIHILE": "Mihile",
    "MIKHAEL": "Mihile",
    "MIKAEL": "Mihile",
    "MICHAEL": "Mihile",
    "ARK": "Ark",
    "ADELE": "Adele",
    "LEF_PIRATE": "Ark",
    "LEFPIRATE": "Ark",
    "LEF_WARRIOR": "Adele",
    "LEFWARRIOR": "Adele",
    "HOYOUNG": "Ho Young",
    "HO_YOUNG": "Ho Young",
    "ANIMA_THIEF": "Ho Young",
}

JOB_LITERAL_ALIASES: dict[str, str] = {
    "ミハエル": "Mihile",
    "ミハイル": "Mihile",
    "Mikhael": "Mihile",
    "Mikhail": "Mihile",
    "Michael": "Mihile",
    "Mihael": "Mihile",
    "アーク": "Ark",
    "アデル": "Adele",
    "ホヨン": "Ho Young",
    "虎影": "Ho Young",
    "Lef Pirate": "Ark",
    "Lef Warrior": "Adele",
}


def normalize_job_key(job_code: str) -> str:
    text = job_code.strip()
    if text.startswith("JobCode_"):
        text = text.removeprefix("JobCode_")
    text = text.upper().replace(" ", "_")
    return re.sub(r"\d+$", "", text)


def format_job_name(job_code: str) -> str:
    if not job_code or not job_code.strip():
        return "Unknown"

    text = job_code.strip()
    if text in JOB_LITERAL_ALIASES:
        return JOB_LITERAL_ALIASES[text]
    lower = text.lower()
    for alias, canonical in JOB_LITERAL_ALIASES.items():
        if alias.lower() == lower:
            return canonical

    base_key = normalize_job_key(job_code)
    if base_key in JOB_DISPLAY_BY_BASE:
        return JOB_DISPLAY_BY_BASE[base_key]

    text = job_code.strip()
    if text.startswith("JobCode_"):
        text = text.removeprefix("JobCode_")
    without_tier = re.sub(r"\d+$", "", text)
    fallback_name = without_tier.replace("_", " ").title()
    logger.warning(
        "Unmapped job_code %r (base_key=%r); falling back to derived name %r. "
        "Consider adding it to JOB_DISPLAY_BY_BASE.",
        job_code,
        base_key,
        fallback_name,
    )
    return fallback_name
