// Ranking-first character search for the raffle calculator (S1/S2).
//
// The board's ranking data (`useBoard().characters`, sourced from
// `data/v2/rankings.json`) is already loaded on every route (BoardProvider),
// so searching it as the user types costs zero network requests -- unlike
// the official-API search button, which is kept as a slower fallback for
// Lv225-unlisted characters (S2). This module is pure/UI-agnostic so both
// the matching algorithm (criterion 1: <=10 results, exact match first) and
// the merge-with-API-results rule (criterion: API-origin takes priority on
// duplicate assetKey) can be unit tested without mounting any component.

const ASSET_KEY_PATTERN = /^CHAR[A-Za-z0-9_-]{4,124}$/;

function normalizeText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function toRankingCandidate(character) {
  return {
    assetKey: character.characterAssetKey,
    displayName: typeof character.name === "string" && character.name ? character.name : character.characterAssetKey,
    level: Number.isInteger(character.level) ? character.level : null,
    jobName: typeof character.job === "string" ? character.job : "",
    worldId: typeof character.worldId === "string" ? character.worldId : "",
    imageUrl: typeof character.imageUrl === "string" ? character.imageUrl : "",
    source: "ranking",
  };
}

/**
 * Searches the ranking board's character list for `query` (trimmed,
 * case-folded, fires from a single character -- part of the match, not just
 * prefix). Only rows with a well-formed `CHAR...` assetKey are eligible
 * (defensive: matches the raffle party's own assetKey validation). Results
 * are grouped ①exact name match ②prefix match ③substring match, each group
 * sorted by ranking `rank` ascending, then capped at `limit`.
 */
export function searchRankingCharacters(characters, query, { limit = 10 } = {}) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery || !Array.isArray(characters)) return [];

  const exact = [];
  const prefix = [];
  const partial = [];
  for (const character of characters) {
    const assetKey = character?.characterAssetKey;
    if (typeof assetKey !== "string" || !ASSET_KEY_PATTERN.test(assetKey)) continue;
    const normalizedName = normalizeText(character.name);
    if (!normalizedName) continue;
    if (normalizedName === normalizedQuery) exact.push(character);
    else if (normalizedName.startsWith(normalizedQuery)) prefix.push(character);
    else if (normalizedName.includes(normalizedQuery)) partial.push(character);
  }

  const byRank = (a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
  exact.sort(byRank);
  prefix.sort(byRank);
  partial.sort(byRank);

  return [...exact, ...prefix, ...partial].slice(0, Math.max(0, limit)).map(toRankingCandidate);
}

/**
 * Combines the live ranking candidates with the (slower, button-triggered)
 * official-API search results into one list, de-duplicated by `assetKey`.
 * API-origin results win on a duplicate assetKey (they are tagged
 * `source: "api"` here regardless of what the caller passed in) and are
 * ordered first, since they represent a more deliberate, explicit user
 * action (S2: "API 由来を上位"); the remaining ranking-only candidates keep
 * their relative order after them.
 */
export function mergeSearchCandidates(rankingCandidates, apiCandidates) {
  const merged = new Map();
  for (const candidate of Array.isArray(apiCandidates) ? apiCandidates : []) {
    if (candidate?.assetKey) merged.set(candidate.assetKey, { ...candidate, source: "api" });
  }
  for (const candidate of Array.isArray(rankingCandidates) ? rankingCandidates : []) {
    if (candidate?.assetKey && !merged.has(candidate.assetKey)) merged.set(candidate.assetKey, candidate);
  }
  return [...merged.values()];
}
