import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeJobPayload } from "./contract.js";

function payload(overrides = {}) {
  return {
    schemaVersion: 3,
    classificationVersion: 1,
    status: "complete",
    progress: { completedCharacters: 2, totalCharacters: 2, stage: "complete", elapsedMs: 10 },
    raffleResults: [{ resultId: "result-other-1", memberId: "member-1", raffledAt: "2026-07-30T00:00:00Z", layerName: "Other Layer", bossCode: null, bossName: "Other Boss", outcome: "WIN", rewards: [{ rewardName: "Other Reward", classification: "OTHER", quantity: "1", won: true }] }],
    clears: [{ clearId: "clear-lucid-hard", boss: "LUCID", bossDifficulty: "HARD", ascendantTier: "Divine Ascendant", partyCount: 2, historyMemberIds: ["member-1"], complete: true, members: [
      { memberId: "member-1", bossNeso: "600", powerCrystalAmount: "100", ascendantNeso: "50", drops: [{ dropId: "coin1", category: "COIN", name: "Phantasma Coin", quantity: "10" }] },
      { memberId: "member-2", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [{ dropId: "gear1", category: "EQUIPMENT", name: "Gear", quantity: "1" }] },
    ] }],
    warnings: [], errors: [], ...overrides,
  };
}

describe("normalizeJobPayload", () => {
  it("accepts all-result display data and a complete party clear", () => {
    const result = normalizeJobPayload(payload());
    expect(result.ok).toBe(true);
    expect(result.data.raffleResults[0].bossCode).toBe(null);
    expect(result.data.clears[0].members[0].drops[0].category).toBe("COIN");
  });

  it("accepts official item icons and rejects arbitrary image origins", () => {
    const official = payload();
    official.raffleResults[0].rewards[0].iconUrl = "https://api-static.msu.io/itemimages/icon/4310218.png";
    official.clears[0].members[1].drops[0].imageUrl = "https://api-static.msu.io/itemimages/icon/1000000.png";
    expect(normalizeJobPayload(official).ok).toBe(true);
    official.raffleResults[0].rewards[0].iconUrl = "https://tracking.example/item.png";
    expect(normalizeJobPayload(official).code).toBe("invalidRaffleReward");
    official.raffleResults[0].rewards[0].iconUrl = "";
    official.clears[0].members[1].drops[0].imageUrl = "https://tracking.example/item.png";
    expect(normalizeJobPayload(official).code).toBe("invalidDrop");
  });
  it("keeps official clear, history, and saved distribution counts independent", () => {
    const partial = payload();
    partial.clears[0].historyMemberIds = ["member-1"];
    partial.clears[0].partyCount = 6;
    expect(normalizeJobPayload(partial).ok).toBe(true);
    partial.clears[0].partyCount = 2;
    partial.clears[0].historyMemberIds = ["member-3"];
    expect(normalizeJobPayload(partial).code).toBe("invalidClear");
    partial.clears[0].historyMemberIds = ["member-1", "member-2"];
    partial.clears[0].partyCount = 1;
    expect(normalizeJobPayload(partial).code).toBe("invalidClear");
  });

  it("rejects a boss difficulty and Ascendant tier mismatch", () => {
    const value = payload();
    value.clears[0].ascendantTier = "Eternal Ascendant";
    expect(normalizeJobPayload(value).code).toBe("invalidClear");
  });
  it("rejects unsafe numeric JSON amounts", () => {
    const value = payload();
    value.clears[0].members[0].bossNeso = 9007199254740993;
    expect(normalizeJobPayload(value).code).toBe("invalidClearMember");
  });

  it("accepts multiple difficulties of one boss but rejects duplicate difficulty candidates", () => {
    const incomplete = payload();
    incomplete.clears[0].complete = false;
    expect(normalizeJobPayload(incomplete).code).toBe("invalidClear");
    const mixed = payload();
    mixed.clears.push(structuredClone(mixed.clears[0]));
    mixed.clears[1].clearId = "clear-lucid-normal";
    mixed.clears[1].bossDifficulty = "NORMAL";
    mixed.clears[1].ascendantTier = "Mystic Ascendant";
    mixed.clears[1].historyMemberIds = ["member-2"];
    mixed.clears[1].members.forEach((member) => { member.drops = []; });
    expect(normalizeJobPayload(mixed).ok).toBe(true);
    mixed.clears[1].bossDifficulty = "HARD";
    mixed.clears[1].ascendantTier = "Divine Ascendant";
    expect(normalizeJobPayload(mixed).code).toBe("invalidClear");
  });

  it("accepts the repository shared weekly contract fixture", () => {
    const fixtureUrl = new URL("../../../../../testdata/raffle/v1/cases/fixture-lucid.json", import.meta.url);
    const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8"));
    const result = normalizeJobPayload(fixture.expectedJob);
    expect(result.ok).toBe(true);
    expect(result.data.clears.map((clear) => clear.boss)).toEqual(["LUCID", "WILL"]);
  });});