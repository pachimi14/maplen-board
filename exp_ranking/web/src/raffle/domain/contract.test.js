import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RAFFLE_CLASSIFICATION_VERSION, normalizeJobPayload } from "./contract.js";

function payload(overrides = {}) {
  return {
    schemaVersion: 3,
    classificationVersion: RAFFLE_CLASSIFICATION_VERSION,
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
  // F1/F2 (LULU-119): FT_ITEM is a valid reward classification and drop
  // category (Will's Sealed Mirror World Nodestone), alongside COIN/EQUIPMENT.
  it("accepts FT_ITEM as a reward classification and drop category", () => {
    const value = payload();
    value.raffleResults[0].rewards[0].classification = "FT_ITEM";
    value.clears[0].members[1].drops[0] = { dropId: "ft1", category: "FT_ITEM", name: "Sealed Mirror World Nodestone", quantity: "1" };
    const result = normalizeJobPayload(value);
    expect(result.ok).toBe(true);
    expect(result.data.clears[0].members[1].drops[0].category).toBe("FT_ITEM");
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

  it("accepts multiple difficulties of one boss but rejects an incomplete clear", () => {
    const incomplete = payload();
    incomplete.clears[0].complete = false;
    expect(normalizeJobPayload(incomplete).code).toBe("invalidClear");
    const mixed = payload();
    mixed.clears.push(structuredClone(mixed.clears[0]));
    mixed.clears[1].clearId = "clear-lucid-normal-p2";
    mixed.clears[1].bossDifficulty = "NORMAL";
    mixed.clears[1].ascendantTier = "Mystic Ascendant";
    mixed.clears[1].historyMemberIds = ["member-2"];
    mixed.clears[1].members.forEach((member) => { member.drops = []; });
    expect(normalizeJobPayload(mixed).ok).toBe(true);
    // docs/IMPL_PLAN_RAFFLE_MULTI_CLEAR.md S2: a second candidate that ends up with the exact
    // same boss+difficulty+partyCount as clears[0] is no longer rejected on that basis alone --
    // two independent clusters can legitimately share it (distinct clearId is what matters).
    mixed.clears[1].bossDifficulty = "HARD";
    mixed.clears[1].ascendantTier = "Divine Ascendant";
    expect(normalizeJobPayload(mixed).ok).toBe(true);
  });

  it("accepts independent partyCount clusters of the same boss+difficulty but rejects a duplicate clearId (LULU-096)", () => {
    const multiCluster = payload();
    multiCluster.clears.push(structuredClone(multiCluster.clears[0]));
    multiCluster.clears[1].clearId = "clear-lucid-hard-p6";
    multiCluster.clears[1].partyCount = 6;
    multiCluster.clears[1].historyMemberIds = ["member-2"];
    multiCluster.clears[1].members.forEach((member) => { member.drops = []; });
    expect(normalizeJobPayload(multiCluster).ok).toBe(true);
    expect(normalizeJobPayload(multiCluster).data.clears.map((clear) => clear.partyCount)).toEqual([2, 6]);

    const exactDuplicate = payload();
    exactDuplicate.clears.push(structuredClone(exactDuplicate.clears[0]));
    exactDuplicate.clears[1].members.forEach((member) => { member.drops = []; });
    expect(normalizeJobPayload(exactDuplicate).code).toBe("invalidClear");
  });

  // docs/IMPL_PLAN_RAFFLE_MULTI_CLEAR.md S2: two independent clusters can legitimately share
  // the same boss+difficulty+partyCount (e.g. two disjoint one-hour parties both clearing at
  // 6 people); uniqueness is keyed on clearId alone, not boss:difficulty:partyCount.
  it("accepts two independent clusters at the same boss+difficulty+partyCount when clearId differs", () => {
    const sameCount = payload();
    sameCount.clears.push(structuredClone(sameCount.clears[0]));
    sameCount.clears[1].clearId = "clear-lucid-hard-p2-2";
    sameCount.clears[1].historyMemberIds = ["member-2"];
    sameCount.clears[1].members.forEach((member) => { member.drops = []; });
    const result = normalizeJobPayload(sameCount);
    expect(result.ok).toBe(true);
    expect(result.data.clears.map((clear) => [clear.clearId, clear.partyCount])).toEqual([
      ["clear-lucid-hard", 2],
      ["clear-lucid-hard-p2-2", 2],
    ]);
  });

  // docs/IMPL_PLAN_RAFFLE_MULTI_CLEAR.md S3: clearedAt lets the UI tell apart same-partyCount
  // candidates by clear time. Invalid/missing values degrade to "" rather than failing the
  // payload.
  it("accepts a valid ISO 8601 clearedAt and normalizes an invalid one to an empty string", () => {
    const withValidClearedAt = payload();
    withValidClearedAt.clears[0].clearedAt = "2026-07-23T14:00:00Z";
    expect(normalizeJobPayload(withValidClearedAt).data.clears[0].clearedAt).toBe("2026-07-23T14:00:00Z");

    const withInvalidClearedAt = payload();
    withInvalidClearedAt.clears[0].clearedAt = "not-a-date";
    const invalidResult = normalizeJobPayload(withInvalidClearedAt);
    expect(invalidResult.ok).toBe(true);
    expect(invalidResult.data.clears[0].clearedAt).toBe("");

    const withoutClearedAt = payload();
    expect(normalizeJobPayload(withoutClearedAt).data.clears[0].clearedAt).toBe("");
  });

  // S3 (docs/IMPL_PLAN_RAFFLE_REWARD_VOCAB.md): excludedRewards surfaces OTHER-classified,
  // non-distributable rewards so a future classification gap is visible instead of silently
  // vanishing. Same degrade-gracefully treatment as clearedAt/memberWallets.
  it("accepts a valid excludedRewards list and defaults to empty when missing/invalid", () => {
    const withRewards = payload();
    withRewards.clears[0].excludedRewards = [{ name: "Sealed Nodestone", quantity: "2" }];
    const result = normalizeJobPayload(withRewards);
    expect(result.ok).toBe(true);
    expect(result.data.clears[0].excludedRewards).toEqual([{ name: "Sealed Nodestone", quantity: "2" }]);

    expect(normalizeJobPayload(payload()).data.clears[0].excludedRewards).toEqual([]);
  });

  it("silently drops malformed excludedRewards entries instead of failing the whole payload", () => {
    const value = payload();
    value.clears[0].excludedRewards = [
      { name: "Sealed Nodestone", quantity: "2" },
      { name: "", quantity: "1" },
      { name: "Bad Quantity", quantity: "not-a-number" },
      { quantity: "3" },
      "not-an-object",
    ];
    const result = normalizeJobPayload(value);
    expect(result.ok).toBe(true);
    expect(result.data.clears[0].excludedRewards).toEqual([{ name: "Sealed Nodestone", quantity: "2" }]);
  });

  it("accepts the repository shared weekly contract fixture", () => {
    const fixtureUrl = new URL("../../../../../testdata/raffle/v1/cases/fixture-lucid.json", import.meta.url);
    const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8"));
    const result = normalizeJobPayload(fixture.expectedJob);
    expect(result.ok).toBe(true);
    expect(result.data.clears.map((clear) => clear.boss)).toEqual(["LUCID", "WILL"]);
    expect(result.data.clears.map((clear) => clear.excludedRewards)).toEqual([[], []]);
    expect(result.data.memberWallets).toEqual({ "member-1": "0x0b89e0acd94a1998c9c7c7ba707d8e639cd44135" });
  });
});

// LULU-069/LULU-103: memberWallets carries each requested member's own owner
// wallet. Format-validated only (0x + 40 hex); malformed entries are dropped
// without failing the whole payload.
describe("normalizeJobPayload memberWallets (LULU-069/LULU-103)", () => {
  it("keeps well-formed 0x + 40-hex wallet entries", () => {
    const value = payload({ memberWallets: { "member-1": "0xEE158FbBF3507A4a7e42C112e49725db4875a5b9" } });
    const result = normalizeJobPayload(value);
    expect(result.ok).toBe(true);
    expect(result.data.memberWallets).toEqual({ "member-1": "0xEE158FbBF3507A4a7e42C112e49725db4875a5b9" });
  });

  it("silently drops malformed wallet entries instead of failing the whole payload", () => {
    const value = payload({
      memberWallets: {
        "member-1": "not-a-wallet",
        "member-2": "0x1234", // too short
        "member-3": 12345, // not a string
      },
    });
    const result = normalizeJobPayload(value);
    expect(result.ok).toBe(true);
    expect(result.data.memberWallets).toEqual({});
  });

  it("defaults to an empty object when memberWallets is missing/invalid", () => {
    expect(normalizeJobPayload(payload()).data.memberWallets).toEqual({});
    expect(normalizeJobPayload(payload({ memberWallets: null })).data.memberWallets).toEqual({});
    expect(normalizeJobPayload(payload({ memberWallets: "not-an-object" })).data.memberWallets).toEqual({});
  });
});