import { describe, expect, it } from "vitest";
import { bossMonogram, formatAscendantTierTitle, formatRaffleTimestamp, formatRewardQuantity, groupRaffleResultsForDisplay, groupWonRewards, isAscendantRaffleResult, powerCrystalFaceValue, rewardClassificationLabel, sortAscendantResultsByTier, splitLayerLabel, summarizeRaffleResults } from "./resultDisplay.js";

describe("raffle result display", () => {
  it("groups all ascendant raffle wins into one display group", () => {
    const results = [
      { resultId: "boss-1", bossName: "Lucid" },
      { resultId: "asc-1", bossName: "Ascendant Tier Raffle" },
      { resultId: "boss-2", bossName: "Will" },
      { resultId: "asc-2", bossName: "Ascendant Tier Raffle" },
    ];
    expect(isAscendantRaffleResult(results[1])).toBe(true);
    expect(groupRaffleResultsForDisplay(results)).toEqual([
      { kind: "single", result: results[0] },
      { kind: "ascendant", results: [results[1], results[3]] },
      { kind: "single", result: results[2] },
    ]);
  });
  it.each([
    ["Dawning Ascendant 1", "Dawning 1 - Normal Guardian Angel Slime"],
    ["Dawning Ascendant 2", "Dawning 2 - Easy Lucid"],
    ["Blessed Ascendant 1", "Blessed 1 - Hard Lotus"],
    ["Blessed Ascendant 2", "Blessed 2 - Hard Damien"],
    ["Mystic Ascendant", "Mystic - Normal Lucid"],
    ["Luminous Ascendant", "Luminous - Easy Will"],
    ["Glorious Ascendant", "Glorious - Normal Will"],
    ["Divine Ascendant", "Divine - Hard Lucid"],
    ["Eternal Ascendant", "Eternal - Hard Will"],
  ])("labels %s with its corresponding boss", (tier, expected) => {
    expect(formatAscendantTierTitle(`[Ascendant Tier Raffle] ${tier}`)).toBe(expected);
  });

  it("sorts Ascendant results from the highest tier to the lowest", () => {
    const tiers = [
      "Blessed Ascendant 1",
      "Dawning Ascendant 1",
      "Eternal Ascendant",
      "Mystic Ascendant",
      "Divine Ascendant",
      "Dawning Ascendant 2",
      "Glorious Ascendant",
      "Blessed Ascendant 2",
      "Luminous Ascendant",
    ];
    const sorted = sortAscendantResultsByTier(tiers.map((layerName) => ({ layerName, bossName: "Ascendant Tier Raffle" })));
    expect(sorted.map((result) => result.layerName)).toEqual([
      "Eternal Ascendant",
      "Divine Ascendant",
      "Glorious Ascendant",
      "Luminous Ascendant",
      "Mystic Ascendant",
      "Blessed Ascendant 2",
      "Blessed Ascendant 1",
      "Dawning Ascendant 2",
      "Dawning Ascendant 1",
    ]);
  });

  it("summarizes NESO, Power Crystal face value, and repeated items across raffles", () => {
    const summary = summarizeRaffleResults([
      { rewards: [
        { rewardName: "NESO", classification: "NESO", quantity: "1500000", won: true },
        { rewardName: "10K Power Crystal Coupon", classification: "POWER_CRYSTAL", quantity: "112", won: true },
        { rewardName: "Sealed Nodestone", classification: "OTHER", quantity: "1", won: true },
      ] },
      { rewards: [
        { rewardName: "NESO", classification: "NESO", quantity: "12000000", won: true },
        { rewardName: "10M Power Crystal Coupon", classification: "POWER_CRYSTAL", quantity: "15", won: true },
        { rewardName: "Sealed Nodestone", classification: "OTHER", quantity: "2", won: true },
      ] },
    ]);
    expect(summary.totalNeso).toBe("13500000");
    expect(summary.totalPowerCrystal).toBe("151120000");
    expect(summary.items.find((item) => item.rewardName === "Sealed Nodestone")?.quantity).toBe("3");
    expect(powerCrystalFaceValue("10M Power Crystal Coupon")).toBe(10000000n);
  });

  // S4 (docs/IMPL_PLAN_RAFFLE_REWARD_VOCAB.md): the official API now also grants Power
  // Crystal directly (server classification POWER_CRYSTAL, display name literally "Power
  // Crystal", quantity IS the amount). Before this fix the weekly-totals preview silently
  // showed 0 for this reward -- the same symptom the user originally reported.
  it("sums a direct Power Crystal grant (quantity IS the amount, face value 1)", () => {
    expect(powerCrystalFaceValue("Power Crystal")).toBe(1n);
    expect(powerCrystalFaceValue(" power crystal ")).toBe(1n);
    const summary = summarizeRaffleResults([
      { rewards: [{ rewardName: "Power Crystal", classification: "POWER_CRYSTAL", quantity: "55000000", won: true }] },
    ]);
    expect(summary.totalPowerCrystal).toBe("55000000");
  });

  it("keeps the legacy coupon-name total unchanged (no regression)", () => {
    const summary = summarizeRaffleResults([
      { rewards: [{ rewardName: "10M Power Crystal Coupon", classification: "POWER_CRYSTAL", quantity: "5", won: true }] },
    ]);
    expect(summary.totalPowerCrystal).toBe("50000000");
  });

  it("sums a mix of direct-grant and legacy-coupon Power Crystal rewards", () => {
    const summary = summarizeRaffleResults([
      { rewards: [
        { rewardName: "Power Crystal", classification: "POWER_CRYSTAL", quantity: "55000000", won: true },
        { rewardName: "10M Power Crystal Coupon", classification: "POWER_CRYSTAL", quantity: "5", won: true },
      ] },
    ]);
    expect(summary.totalPowerCrystal).toBe("105000000");
  });

  it("treats a non-matching name as face value 0", () => {
    expect(powerCrystalFaceValue("Item 1000")).toBe(0n);
    expect(powerCrystalFaceValue("Something Else")).toBe(0n);
    expect(powerCrystalFaceValue("")).toBe(0n);
  });

  it("groups repeated won items without mixing classifications", () => {
    expect(groupWonRewards([
      { rewardName: "Phantasma Coin", classification: "COIN", quantity: "1", won: true, iconUrl: "https://api-static.msu.io/itemimages/icon/4310218.png" },
      { rewardName: "Phantasma Coin", classification: "COIN", quantity: "2", won: true, iconUrl: "https://api-static.msu.io/itemimages/icon/4310218.png" },
      { rewardName: "Phantasma Coin", classification: "OTHER", quantity: "99", won: false },
    ])).toEqual([{ rewardName: "Phantasma Coin", classification: "COIN", quantity: "3", won: true, iconUrl: "https://api-static.msu.io/itemimages/icon/4310218.png" }]);
  });

  it("extracts difficulty and avoids repeating the boss name", () => {
    expect(splitLayerLabel("[Hard] Lucid", "Lucid")).toEqual({ difficulty: "Hard", detail: "" });
    expect(splitLayerLabel("[Ascendant Tier Raffle] Divine Ascendant", "Ascendant Tier Raffle")).toEqual({ difficulty: "Ascendant Tier Raffle", detail: "Divine Ascendant" });
  });

  it("formats compact labels and exact large quantities", () => {
    expect(bossMonogram("Crimson Queen")).toBe("CQ");
    expect(formatRaffleTimestamp("2026-07-30T00:00:00Z")).toBe("2026/07/30 00:00 UTC");
    expect(formatRewardQuantity("9007199254740993123")).toBe("9,007,199,254,740,993,123");
  });
});

// R1/LULU-119 code review: FT_ITEM must resolve to a human label, and any
// classification the server can send (known or not) must never render as its
// raw technical string (LULU-084).
describe("rewardClassificationLabel (LULU-084: never show a raw classification code)", () => {
  it("labels every known classification, including FT_ITEM", () => {
    expect(rewardClassificationLabel("NESO")).toBe("NESO");
    expect(rewardClassificationLabel("POWER_CRYSTAL")).toBe("Power Crystal");
    expect(rewardClassificationLabel("COIN")).toBe("Coin");
    expect(rewardClassificationLabel("EQUIPMENT")).toBe("Equipment");
    expect(rewardClassificationLabel("FT_ITEM")).toBe("FT Item");
    expect(rewardClassificationLabel("ASCENDANT_NESO")).toBe("Ascendant NESO");
    expect(rewardClassificationLabel("OTHER")).toBe("Other");
    expect(rewardClassificationLabel("UNKNOWN")).toBe("Unknown");
  });

  it("falls back to the Unknown label instead of the raw code for any unrecognized classification", () => {
    expect(rewardClassificationLabel("SOME_FUTURE_CLASSIFICATION")).toBe("Unknown");
    expect(rewardClassificationLabel("")).toBe("Unknown");
    expect(rewardClassificationLabel(undefined)).toBe("Unknown");
  });
});
