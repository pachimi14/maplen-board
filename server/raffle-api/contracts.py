from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, field_validator



class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CharacterInput(StrictModel):
    memberId: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    assetKey: str = Field(min_length=8, max_length=128, pattern=r"^CHAR[A-Za-z0-9_-]+$")
    walletOverride: str | None = Field(default=None, min_length=8, max_length=128)


class ResolveCharacterRequest(CharacterInput):
    pass


class CharacterSearchRequest(StrictModel):
    query: str = Field(min_length=2, max_length=24)

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 2 or len(normalized) > 24:
            raise ValueError("query must contain 2 to 24 characters")
        if any(character.isspace() or ord(character) < 32 for character in normalized):
            raise ValueError("query must be a single character name")
        return normalized



class CreateJobRequest(StrictModel):
    raffledAt: str = Field(min_length=20, max_length=40)
    characters: list[CharacterInput] = Field(min_length=1, max_length=6)

    @field_validator("raffledAt")
    @classmethod
    def validate_raffled_at(cls, value: str) -> str:
        if not value.endswith("Z") or "T" not in value:
            raise ValueError("raffledAt must be an ISO 8601 UTC value")
        try:
            parsed = datetime.fromisoformat(value[:-1] + "+00:00")
        except ValueError as exc:
            raise ValueError("raffledAt must be a valid ISO 8601 UTC value") from exc
        parsed = parsed.astimezone(timezone.utc)
        if parsed.weekday() != 3 or any(
            (parsed.hour, parsed.minute, parsed.second, parsed.microsecond)
        ):
            raise ValueError("raffledAt must be Thursday 00:00 UTC")
        return value

    @field_validator("characters")
    @classmethod
    def validate_unique_members(cls, value: list[CharacterInput]) -> list[CharacterInput]:
        member_ids = [entry.memberId for entry in value]
        asset_keys = [entry.assetKey for entry in value]
        if len(set(member_ids)) != len(member_ids):
            raise ValueError("memberId values must be unique")
        if len(set(asset_keys)) != len(asset_keys):
            raise ValueError("assetKey values must be unique")
        return value