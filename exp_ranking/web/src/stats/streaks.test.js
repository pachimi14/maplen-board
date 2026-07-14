import { describe, expect, it } from "vitest";
import { computeDailyRankStreak, computePositiveGainStreak } from "./streaks.js";

const day = (snapshotDate, dailyGain, dailyRank = null) => ({ snapshotDate, dailyGain, dailyRank });

describe("computePositiveGainStreak", () => {
  it("counts a run of consecutive positive-gain calendar days", () => {
    const history = [
      day("2026-07-01", 10),
      day("2026-07-02", 20),
      day("2026-07-03", 5),
      day("2026-07-04", 1),
      day("2026-07-05", 30),
    ];
    expect(computePositiveGainStreak(history)).toEqual({ current: 5, longest: 5 });
  });

  it("ends the streak on a missing calendar day, even though the array is adjacent", () => {
    const history = [
      day("2026-07-01", 10),
      day("2026-07-02", 20),
      day("2026-07-03", 5),
      // 07-04 missing entirely (no point) — a gap, not a failed condition.
      day("2026-07-05", 7),
      day("2026-07-06", 8),
    ];
    // longest run = 3 (07-01..07-03); current run = 2 (07-05..07-06, most recent date).
    expect(computePositiveGainStreak(history)).toEqual({ current: 2, longest: 3 });
  });

  it("produces the same result for reversed/unsorted input", () => {
    const history = [
      day("2026-07-01", 10),
      day("2026-07-02", 20),
      day("2026-07-03", 5),
      day("2026-07-05", 7),
      day("2026-07-06", 8),
    ];
    const reversed = [...history].reverse();
    const shuffled = [history[3], history[0], history[4], history[2], history[1]];

    const expected = computePositiveGainStreak(history);
    expect(computePositiveGainStreak(reversed)).toEqual(expected);
    expect(computePositiveGainStreak(shuffled)).toEqual(expected);
  });

  it("folds duplicate snapshotDate to the higher-dailyGain point (contract order)", () => {
    const history = [
      day("2026-07-01", 10),
      // Duplicate for 07-02: a losing (non-qualifying) row and a winning
      // (qualifying) row. The higher dailyGain must be the one adopted.
      day("2026-07-02", -5),
      day("2026-07-02", 15),
      day("2026-07-03", 8),
    ];
    // If the negative duplicate had won, the streak would break at 07-02.
    expect(computePositiveGainStreak(history)).toEqual({ current: 3, longest: 3 });
  });

  it("treats null/0/negative dailyGain as non-qualifying (breaks the streak)", () => {
    const history = [
      day("2026-07-01", 10),
      day("2026-07-02", 0),
      day("2026-07-03", null),
      day("2026-07-04", -3),
      day("2026-07-05", 6),
    ];
    // Only 07-01 and 07-05 qualify, and they aren't adjacent to each other.
    expect(computePositiveGainStreak(history)).toEqual({ current: 1, longest: 1 });
  });

  it("returns current=0 when the latest confirmed day fails, but keeps longest", () => {
    const history = [
      day("2026-07-01", 10),
      day("2026-07-02", 20),
      day("2026-07-03", 30),
      day("2026-07-04", -1),
    ];
    expect(computePositiveGainStreak(history)).toEqual({ current: 0, longest: 3 });
  });
});

describe("computeDailyRankStreak", () => {
  it("counts consecutive days within maxRank, inclusive boundary", () => {
    const history = [
      day("2026-07-01", 10, 500),
      day("2026-07-02", 10, 501),
    ];
    // 07-01 qualifies (rank exactly 500), 07-02 does not (501 > 500):
    // streak breaks, current run ends at a non-qualifying day.
    expect(computeDailyRankStreak(history, { maxRank: 500 })).toEqual({ current: 0, longest: 1 });
  });

  it("treats null/out-of-range dailyRank as non-qualifying", () => {
    const history = [
      day("2026-07-01", 5, 100),
      day("2026-07-02", 5, null),
      day("2026-07-03", 5, 100),
      day("2026-07-04", 5, 700),
    ];
    expect(computeDailyRankStreak(history, { maxRank: 500 })).toEqual({ current: 0, longest: 1 });
  });

  it("returns {0,0} for an invalid maxRank (non-positive or missing)", () => {
    const history = [day("2026-07-01", 5, 1)];
    expect(computeDailyRankStreak(history, { maxRank: 0 })).toEqual({ current: 0, longest: 0 });
    expect(computeDailyRankStreak(history, { maxRank: -5 })).toEqual({ current: 0, longest: 0 });
    expect(computeDailyRankStreak(history, {})).toEqual({ current: 0, longest: 0 });
  });

  it("computes current/longest for a consecutive in-range run", () => {
    const history = [
      day("2026-07-01", 5, 300),
      day("2026-07-02", 5, 200),
      day("2026-07-03", 5, 450),
    ];
    expect(computeDailyRankStreak(history, { maxRank: 500 })).toEqual({ current: 3, longest: 3 });
  });
});
