// World-id display rule for the raffle calculator (S3'/LULU-116).
//
// `worldId` is display-only (it never feeds the API request, boss-clear
// matching, or settlement calculation -- LULU-116) and is stored as-is
// from whichever source added the member: ranking data uses readable
// world names ("Ain"/"Fang"/"Errai"), the official API returns an opaque
// numeric world id (e.g. "2") that carries no meaning to a player. Only
// the former is worth showing; the latter would just be noise.

const NUMERIC_ONLY_PATTERN = /^\d+$/;

/** True when `worldId` is a non-empty, human-readable world name worth displaying (not a bare numeric id). */
export function isDisplayableWorldId(worldId) {
  if (typeof worldId !== "string") return false;
  const trimmed = worldId.trim();
  return trimmed.length > 0 && !NUMERIC_ONLY_PATTERN.test(trimmed);
}
