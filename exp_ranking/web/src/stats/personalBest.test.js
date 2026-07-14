import { describe, expect, it } from "vitest";
import { computeDailyGainSelfRank } from "./personalBest.js";

const day = (snapshotDate, dailyGain) => ({ snapshotDate, dailyGain });

describe("computeDailyGainSelfRank", () => {
  const history = [
    day("2026-07-01", 100),
    day("2026-07-02", 100),
    day("2026-07-03", 90),
  ];

  it("uses competition ranking: 100,100,90 -> ranks 1,1,3", () => {
    expect(computeDailyGainSelfRank(history, { onDate: "2026-07-01" })).toEqual({
      rank: 1,
      totalComparableDays: 3,
      gain: 100,
      isTied: true,
    });
    expect(computeDailyGainSelfRank(history, { onDate: "2026-07-02" })).toEqual({
      rank: 1,
      totalComparableDays: 3,
      gain: 100,
      isTied: true,
    });
    expect(computeDailyGainSelfRank(history, { onDate: "2026-07-03" })).toEqual({
      rank: 3,
      totalComparableDays: 3,
      gain: 90,
      isTied: false,
    });
  });

  it("defaults onDate to the latest snapshotDate in history", () => {
    expect(computeDailyGainSelfRank(history)).toEqual(
      computeDailyGainSelfRank(history, { onDate: "2026-07-03" })
    );
  });

  it("returns rank=null when the basis date has no comparable gain", () => {
    const withMissingLatest = [...history, day("2026-07-04", null)];
    // Default basis date is the overall latest snapshotDate (07-04), even
    // though that day's gain isn't comparable.
    const result = computeDailyGainSelfRank(withMissingLatest);
    expect(result.rank).toBeNull();
    expect(result.gain).toBeNull();
    expect(result.isTied).toBe(false);
    expect(result.totalComparableDays).toBe(3);
  });

  it("excludes null/NaN dailyGain points from totalComparableDays", () => {
    const withGaps = [
      day("2026-07-01", 100),
      day("2026-07-02", null),
      day("2026-07-03", NaN),
      day("2026-07-04", 50),
    ];
    const result = computeDailyGainSelfRank(withGaps, { onDate: "2026-07-04" });
    expect(result.totalComparableDays).toBe(2);
    expect(result.rank).toBe(2);
    expect(result.gain).toBe(50);
    expect(result.isTied).toBe(false);
  });

  it("is independent of array order", () => {
    const shuffled = [history[2], history[0], history[1]];
    expect(computeDailyGainSelfRank(shuffled, { onDate: "2026-07-01" })).toEqual(
      computeDailyGainSelfRank(history, { onDate: "2026-07-01" })
    );
  });
});
