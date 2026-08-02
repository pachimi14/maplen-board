import { describe, expect, it } from "vitest";
import { bossMonogram, formatAscendantTierTitle, formatRaffleTimestamp, formatRewardQuantity, groupRaffleResultsForDisplay, groupWonRewards, isAscendantRaffleResult, powerCrystalFaceValue, sortAscendantResultsByTier, splitLayerLabel, summarizeRaffleResults } from "./resultDisplay.js";

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