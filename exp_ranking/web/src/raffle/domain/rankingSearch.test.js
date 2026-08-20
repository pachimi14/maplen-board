import { describe, expect, it } from "vitest";
import { mergeSearchCandidates, searchRankingCharacters } from "./rankingSearch.js";

// Synthesizes a ranking payload the same shape/scale as the real
// data/v2/rankings.json (8,428 CHAR-format rows, IMPL_PLAN §0), so the
// <=10-results/ordering guarantee (criterion 1) is pinned against a
// realistic dataset rather than a handful of hand-picked fixtures.
function syntheticCharacters(count = 8428) {
  const characters = [];
  for (let index = 0; index < count; index += 1) {
    const rank = index + 1;
    characters.push({
      rank,
      name: "Player" + rank,
      job: "Shadower",
      level: 225 + (index % 38),
      worldId: ["Ain", "Fang", "Errai"][index % 3],
      imageUrl: "https://example.test/" + rank + ".png",
      characterAssetKey: "CHARfixture" + String(rank).padStart(8, "0"),
    });
  }
  // A dedicated exact-match target buried deep (high rank number = low
  // priority) so the "exact match always first" rule is actually exercised
  // against many higher-ranked prefix/partial matches.
  characters.push({
    rank: 9000,
    name: "Lumi",
    job: "Bishop",
    level: 240,
    worldId: "Ain",
    imageUrl: "",
    characterAssetKey: "CHARfixtureexactlumi",
  });
  characters.push({
    rank: 1,
    name: "LumiFan",
    job: "Bishop",
    level: 260,
    worldId: "Ain",
    imageUrl: "",
    characterAssetKey: "CHARfixtureprefixlumi",
  });
  characters.push({
    rank: 2,
    name: "xLumix",
    job: "Bishop",
    level: 260,
    worldId: "Ain",
    imageUrl: "",
    characterAssetKey: "CHARfixturepartiallumi",
  });
  return characters;
}

describe("searchRankingCharacters", () => {
  const characters = syntheticCharacters();

  it("caps results at 10 and puts the exact match first, ahead of higher-ranked prefix/partial matches", () => {
    const results = searchRankingCharacters(characters, "Lumi", { limit: 10 });
    expect(results.length).toBeLessThanOrEqual(10);
    expect(results[0]).toMatchObject({ assetKey: "CHARfixtureexactlumi", displayName: "Lumi", source: "ranking" });
    expect(results[1].assetKey).toBe("CHARfixtureprefixlumi"); // prefix match, ranked above partial
    expect(results[2].assetKey).toBe("CHARfixturepartiallumi"); // partial (substring) match
  });

  it("fires from a single character and matches case-insensitively, ignoring surrounding whitespace", () => {
    const results = searchRankingCharacters(characters, "l", { limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    const upper = searchRankingCharacters(characters, "  LUMI  ", { limit: 10 });
    expect(upper.map((r) => r.assetKey)).toContain("CHARfixtureexactlumi");
  });

  it("returns no candidates for an empty/whitespace-only query", () => {
    expect(searchRankingCharacters(characters, "")).toEqual([]);
    expect(searchRankingCharacters(characters, "   ")).toEqual([]);
  });

  it("sorts within each match group by ranking rank ascending", () => {
    const results = searchRankingCharacters(characters, "Player", { limit: 5 });
    const ranks = results.map((r) => Number(r.assetKey.replace("CHARfixture", "")));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks).toEqual([1, 2, 3, 4, 5]);
  });

  it("excludes rows without a well-formed CHAR assetKey (defensive, S1 §1 note)", () => {
    const withBadRow = [
      { rank: 1, name: "Broken", job: "Thief", level: 225, worldId: "Ain", imageUrl: "", characterAssetKey: "NOTCHAR123" },
      { rank: 2, name: "Broken", job: "Thief", level: 225, worldId: "Ain", imageUrl: "", characterAssetKey: "CHARok12345" },
    ];
    const results = searchRankingCharacters(withBadRow, "Broken");
    expect(results).toHaveLength(1);
    expect(results[0].assetKey).toBe("CHARok12345");
  });

  it("maps ranking fields to the shared candidate shape (assetKey/displayName/level/jobName/worldId/imageUrl/source)", () => {
    const [candidate] = searchRankingCharacters(characters, "LumiFan");
    expect(candidate).toEqual({
      assetKey: "CHARfixtureprefixlumi",
      displayName: "LumiFan",
      level: 260,
      jobName: "Bishop",
      worldId: "Ain",
      imageUrl: "",
      source: "ranking",
    });
  });

  it("handles non-array input gracefully", () => {
    expect(searchRankingCharacters(null, "a")).toEqual([]);
    expect(searchRankingCharacters(undefined, "a")).toEqual([]);
  });
});

describe("mergeSearchCandidates", () => {
  it("de-duplicates by assetKey, letting the API-origin entry win and appear first", () => {
    const ranking = [
      { assetKey: "CHARdup", displayName: "Old Name", level: 225, jobName: "Thief", worldId: "Ain", imageUrl: "", source: "ranking" },
      { assetKey: "CHARrankonly", displayName: "Ranking Only", level: 230, jobName: "Bishop", worldId: "Fang", imageUrl: "", source: "ranking" },
    ];
    const api = [
      { assetKey: "CHARdup", displayName: "Fresh Name", level: 226, jobName: "Thief", worldId: "2" },
    ];
    const merged = mergeSearchCandidates(ranking, api);
    expect(merged.map((c) => c.assetKey)).toEqual(["CHARdup", "CHARrankonly"]);
    expect(merged[0]).toMatchObject({ displayName: "Fresh Name", source: "api" });
    expect(merged[1]).toMatchObject({ displayName: "Ranking Only", source: "ranking" });
  });

  it("returns ranking-only candidates unchanged when there are no API results", () => {
    const ranking = [{ assetKey: "CHARsolo", displayName: "Solo", level: 225, jobName: "Thief", worldId: "Ain", imageUrl: "", source: "ranking" }];
    expect(mergeSearchCandidates(ranking, [])).toEqual(ranking);
  });

  it("handles non-array/empty input gracefully", () => {
    expect(mergeSearchCandidates(null, null)).toEqual([]);
    expect(mergeSearchCandidates(undefined, undefined)).toEqual([]);
  });
});
