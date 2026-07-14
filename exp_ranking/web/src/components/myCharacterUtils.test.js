import { describe, expect, it } from "vitest";
import {
  buildGoalDisplayModel,
  classifyHistoryAvailability,
  errorMessageKeyForCode,
  isLatestDateToday,
  limitWithOthers,
  pickBestRankStreak,
  rankMovementDirection,
  resolveDisplayedHistoryKey,
  roundPercent,
  shouldStartHistoryFetch,
} from "./myCharacterUtils.js";
import { computeDailyRankStreak } from "../stats/index.js";

/** Sanity helper for the pickBestRankStreak fixtures below — reads the
 * exact same `current` field pickBestRankStreak itself reads, via the
 * real (unmocked) T3 computeDailyRankStreak, so a fixture typo fails at
 * the assertion that states the intended per-tier number, not silently
 * inside pickBestRankStreak's own logic. */
function computeDailyRankStreakCurrent(history, maxRank) {
  return computeDailyRankStreak(history, { maxRank }).current;
}

describe("errorMessageKeyForCode", () => {
  it("maps known T4a failure codes to myCharacters.error.* keys", () => {
    expect(errorMessageKeyForCode("saveFailed")).toBe("myCharacters.error.saveFailed");
    expect(errorMessageKeyForCode("limitReached")).toBe("myCharacters.error.limitReached");
    expect(errorMessageKeyForCode("invalidKey")).toBe("myCharacters.error.invalidKey");
    expect(errorMessageKeyForCode("invalidGoal")).toBe("myCharacters.error.invalidGoal");
    expect(errorMessageKeyForCode("unsupportedVersion")).toBe("myCharacters.error.unsupportedVersion");
  });

  it("returns null for no-op / unknown codes so callers don't show a spurious error", () => {
    expect(errorMessageKeyForCode("added")).toBeNull();
    expect(errorMessageKeyForCode("alreadyPinned")).toBeNull();
    expect(errorMessageKeyForCode("notPinned")).toBeNull();
    expect(errorMessageKeyForCode("set")).toBeNull();
    expect(errorMessageKeyForCode("cleared")).toBeNull();
    expect(errorMessageKeyForCode(undefined)).toBeNull();
  });
});

describe("limitWithOthers", () => {
  it("passes through lists at or under the cap with othersCount 0", () => {
    expect(limitWithOthers([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], othersCount: 0 });
    expect(limitWithOthers([], 3)).toEqual({ shown: [], othersCount: 0 });
  });

  it("caps at `max` and reports the hidden count", () => {
    expect(limitWithOthers([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2, 3], othersCount: 2 });
  });

  it("treats a non-array input as empty", () => {
    expect(limitWithOthers(null, 3)).toEqual({ shown: [], othersCount: 0 });
    expect(limitWithOthers(undefined, 3)).toEqual({ shown: [], othersCount: 0 });
  });
});

describe("resolveDisplayedHistoryKey", () => {
  it("keeps `current` when it is still pinned", () => {
    expect(resolveDisplayedHistoryKey("b", ["a", "b", "c"], "a")).toBe("b");
  });

  it("falls back to the primary when current is no longer pinned", () => {
    expect(resolveDisplayedHistoryKey("removed", ["a", "b"], "b")).toBe("b");
  });

  it("falls back to the first remaining pin when the primary itself is gone", () => {
    expect(resolveDisplayedHistoryKey("removed", ["a", "b"], "removed")).toBe("a");
    expect(resolveDisplayedHistoryKey("removed", ["a", "b"], null)).toBe("a");
  });

  it("falls back to null (CTA) once nothing remains pinned", () => {
    expect(resolveDisplayedHistoryKey("removed", [], null)).toBeNull();
  });

  it("treats a null current (never displayed) the same as unpinned", () => {
    expect(resolveDisplayedHistoryKey(null, ["a"], "a")).toBe("a");
  });
});

describe("isLatestDateToday", () => {
  it("is true when the latest snapshot date matches the device's JST calendar date", () => {
    const reference = new Date("2026-07-14T03:00:00Z"); // 12:00 JST same day
    expect(isLatestDateToday("2026-07-14", reference)).toBe(true);
  });

  it("is false when the latest snapshot date is behind (delayed/missed run)", () => {
    const reference = new Date("2026-07-14T03:00:00Z");
    expect(isLatestDateToday("2026-07-13", reference)).toBe(false);
  });

  it("is false for missing/invalid input rather than throwing", () => {
    expect(isLatestDateToday(null)).toBe(false);
    expect(isLatestDateToday(undefined)).toBe(false);
    expect(isLatestDateToday("")).toBe(false);
  });
});

describe("roundPercent", () => {
  it("rounds to the requested decimal places", () => {
    expect(roundPercent(12.345, 1)).toBe(12.3);
    expect(roundPercent(12.35, 1)).toBe(12.4);
    expect(roundPercent(0.049, 1)).toBe(0);
  });

  it("defaults to 1 decimal place", () => {
    expect(roundPercent(3.14159)).toBe(3.1);
  });

  it("returns null for non-finite input instead of NaN", () => {
    expect(roundPercent(null)).toBeNull();
    expect(roundPercent(undefined)).toBeNull();
    expect(roundPercent(NaN)).toBeNull();
  });
});

describe("classifyHistoryAvailability", () => {
  it("reports loading/failed from the caller-tracked fetch status when there is no data yet", () => {
    expect(classifyHistoryAvailability(undefined, "loading")).toBe("loading");
    expect(classifyHistoryAvailability(undefined, "failed")).toBe("failed");
  });

  it("is idle when no history array exists yet and no fetch is in flight", () => {
    expect(classifyHistoryAvailability(undefined, "idle")).toBe("idle");
    expect(classifyHistoryAvailability(null, undefined)).toBe("idle");
  });

  it("is insufficient for a too-short (but loaded) history", () => {
    expect(classifyHistoryAvailability([{ snapshotDate: "2026-07-01" }], "idle")).toBe("insufficient");
    expect(classifyHistoryAvailability([], "idle")).toBe("insufficient");
  });

  it("is ready once at least two points are loaded", () => {
    expect(
      classifyHistoryAvailability(
        [{ snapshotDate: "2026-07-01" }, { snapshotDate: "2026-07-02" }],
        "idle",
      ),
    ).toBe("ready");
  });

  it("LULU-028 regression: real data always wins over a stale loading/failed status", () => {
    // This is exactly the P0 shape: an abandoned fetch attempt's status
    // ("loading"/"failed") never gets cleared for a key the user switched
    // away from and back to, but the history itself *did* arrive in board
    // state in the meantime. The UI must show it as ready, not stuck.
    const readyHistory = [{ snapshotDate: "2026-07-01" }, { snapshotDate: "2026-07-02" }];
    expect(classifyHistoryAvailability(readyHistory, "loading")).toBe("ready");
    expect(classifyHistoryAvailability(readyHistory, "failed")).toBe("ready");
    expect(classifyHistoryAvailability([{ snapshotDate: "2026-07-01" }], "failed")).toBe("insufficient");
  });
});

describe("rankMovementDirection", () => {
  it("is unknown when there is no previous rank to compare against", () => {
    expect(rankMovementDirection(null, 5)).toBe("unknown");
    expect(rankMovementDirection(undefined, -3)).toBe("unknown");
  });

  it("is up/down per the sign of rankFluctuation once comparable", () => {
    expect(rankMovementDirection(10, 3)).toBe("up");
    expect(rankMovementDirection(10, -3)).toBe("down");
  });

  it("is same for zero or non-finite fluctuation once comparable", () => {
    expect(rankMovementDirection(10, 0)).toBe("same");
    expect(rankMovementDirection(10, NaN)).toBe("same");
  });
});

describe("shouldStartHistoryFetch", () => {
  const readyHistory = [{ snapshotDate: "2026-07-01" }, { snapshotDate: "2026-07-02" }];

  it("is false when there is no key to fetch for (§22.2: no more expand/collapse gate)", () => {
    expect(shouldStartHistoryFetch({ historyKey: null, history: undefined, status: undefined })).toBe(false);
    expect(shouldStartHistoryFetch({ historyKey: undefined, history: undefined, status: undefined })).toBe(false);
  });

  it("is false once history has already arrived, regardless of a stale status", () => {
    expect(shouldStartHistoryFetch({ historyKey: "asset:a", history: readyHistory, status: undefined })).toBe(false);
    // LULU-028: a leftover "loading"/"failed" for a key whose data actually
    // arrived (e.g. via an abandoned/canceled prior attempt) must not cause
    // a redundant re-fetch either.
    expect(shouldStartHistoryFetch({ historyKey: "asset:a", history: readyHistory, status: "loading" })).toBe(false);
    expect(shouldStartHistoryFetch({ historyKey: "asset:a", history: readyHistory, status: "failed" })).toBe(false);
  });

  it("is false while a fetch is already loading or has already failed (only retry clears it)", () => {
    expect(shouldStartHistoryFetch({ historyKey: "asset:a", history: undefined, status: "loading" })).toBe(false);
    expect(shouldStartHistoryFetch({ historyKey: "asset:a", history: undefined, status: "failed" })).toBe(false);
  });

  it("is true when keyed, not yet loaded, and not already in flight/failed (displaying is enough — no expand step)", () => {
    expect(shouldStartHistoryFetch({ historyKey: "asset:a", history: undefined, status: undefined })).toBe(true);
    expect(shouldStartHistoryFetch({ historyKey: "asset:a", history: null, status: "idle" })).toBe(true);
  });
});

describe("buildGoalDisplayModel", () => {
  // Same fixture shape as stats/goalProgress.test.js: every level 230..239
  // costs 1000 EXP; level=230, 0 EXP into the current level, one history
  // point supplying the default todayIso (2026-07-10).
  // remainingExpToLevel(target=232) = 2000 (1000 left in 230 + 1000 for 231).
  const expTable = {};
  for (let lvl = 230; lvl < 240; lvl += 1) {
    expTable[lvl] = 1000;
  }
  const character = {
    level: 230,
    exp: 0,
    history: [{ snapshotDate: "2026-07-10", dailyGain: 100 }],
  };

  it("reports no goal as hasGoal:false / indeterminate, without calling computeGoalProgress's math", () => {
    const model = buildGoalDisplayModel({ character, expTable, goal: null, todayGain: 100 });
    expect(model).toEqual({
      hasGoal: false,
      targetLevel: null,
      targetDateIso: null,
      todayGain: 100,
      requiredDailyGain: null,
      achievementRate: null,
      estimatedArrivalDate: null,
      daysDelta: null,
      indeterminate: true,
      achieved: false,
    });
  });

  it("classifies ahead, with the achievement rate derived from todayGain/requiredDailyGain", () => {
    const model = buildGoalDisplayModel({
      character,
      expTable,
      goal: { targetLevel: 232, targetDateIso: "2026-08-15" },
      todayGain: 100,
    });
    // daysUntilTarget = 36, requiredDailyGain = ceil(2000/36) = 56
    expect(model.hasGoal).toBe(true);
    expect(model.requiredDailyGain).toBe(56);
    expect(model.estimatedArrivalDate).toBe("2026-07-30");
    expect(model.daysDelta).toBe(16);
    expect(model.achievementRate).toBeCloseTo(100 / 56, 5);
    expect(model.achieved).toBe(false);
    expect(model.indeterminate).toBe(false);
  });

  it("classifies behind, with an achievement rate below 1", () => {
    const model = buildGoalDisplayModel({
      character,
      expTable,
      goal: { targetLevel: 232, targetDateIso: "2026-07-20" },
      todayGain: 100,
    });
    expect(model.requiredDailyGain).toBe(200);
    expect(model.daysDelta).toBe(-10);
    expect(model.achievementRate).toBeCloseTo(0.5, 5);
    expect(model.indeterminate).toBe(false);
  });

  it("classifies an exact achievement-rate boundary (today == required) as onTrack, rate 1.0", () => {
    const model = buildGoalDisplayModel({
      character,
      expTable,
      goal: { targetLevel: 232, targetDateIso: "2026-07-30" },
      todayGain: 100,
    });
    expect(model.requiredDailyGain).toBe(100);
    expect(model.daysDelta).toBe(0);
    expect(model.achievementRate).toBe(1);
    expect(model.indeterminate).toBe(false);
  });

  it("marks an already-achieved goal as achieved with a positive todayGain (not indeterminate)", () => {
    const achievedCharacter = { ...character, level: 232 };
    const model = buildGoalDisplayModel({
      character: achievedCharacter,
      expTable,
      goal: { targetLevel: 232, targetDateIso: "2026-08-15" },
      todayGain: 100,
    });
    expect(model.achieved).toBe(true);
    expect(model.indeterminate).toBe(false);
    expect(model.estimatedArrivalDate).toBe("2026-07-10");
  });

  it("an already-achieved goal with 0 todayGain is both achieved AND indeterminate (achieved takes UI priority)", () => {
    const achievedCharacter = { ...character, level: 232 };
    const model = buildGoalDisplayModel({
      character: achievedCharacter,
      expTable,
      goal: { targetLevel: 232, targetDateIso: "2026-08-15" },
      todayGain: 0,
    });
    expect(model.achieved).toBe(true);
    expect(model.indeterminate).toBe(true);
  });

  it("is indeterminate (with a null requiredDailyGain/achievementRate) for a 0 todayGain, not-yet-achieved goal", () => {
    const model = buildGoalDisplayModel({
      character,
      expTable,
      goal: { targetLevel: 232, targetDateIso: "2026-08-15" },
      todayGain: 0,
    });
    expect(model.indeterminate).toBe(true);
    expect(model.achieved).toBe(false);
    expect(model.requiredDailyGain).toBeNull();
    expect(model.achievementRate).toBeNull();
    expect(model.estimatedArrivalDate).toBeNull();
  });

  it("is indeterminate for a missing/undefined todayGain (never passes 0 as a valid pace)", () => {
    const model = buildGoalDisplayModel({
      character,
      expTable,
      goal: { targetLevel: 232, targetDateIso: "2026-08-15" },
      todayGain: undefined,
    });
    expect(model.todayGain).toBe(0);
    expect(model.indeterminate).toBe(true);
    expect(model.achievementRate).toBeNull();
  });

  it("is indeterminate without crashing when the character has no history yet (todayIso unresolvable)", () => {
    const noHistoryCharacter = { level: 230, exp: 0 };
    const model = buildGoalDisplayModel({
      character: noHistoryCharacter,
      expTable,
      goal: { targetLevel: 232, targetDateIso: "2026-08-15" },
      todayGain: 100,
    });
    expect(model.indeterminate).toBe(true);
    expect(model.estimatedArrivalDate).toBeNull();
  });
});

// Builds sequential calendar-day history points (oldest -> newest) ending
// on `lastDateIso`, one entry per `ranks` value (also oldest -> newest) —
// used to construct the exact per-tier `current` streak counts asserted
// below without hand-computing ISO dates.
function sequentialDates(count, lastDateIso) {
  const [y, m, d] = lastDateIso.split("-").map(Number);
  const lastMs = Date.UTC(y, m - 1, d);
  const dates = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    dates.push(new Date(lastMs - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return dates;
}

function historyFromRanks(ranks, lastDateIso = "2026-07-21") {
  return sequentialDates(ranks.length, lastDateIso).map((snapshotDate, index) => ({
    snapshotDate,
    dailyRank: ranks[index],
  }));
}

describe("pickBestRankStreak (T4b §22.11 A⑤)", () => {
  const TIERS = [5, 10, 50, 100, 500];

  // §22.11 confirmed contract (user-fixed 2026-07-15): current(1)=1,
  // current(2)+ picks the strictest qualifying tier, current<=1 everywhere
  // yields null. These 4 examples are pinned exactly as specified.
  it("[confirmed] Top5=2, Top10=8, Top500=20 -> picks the strictest: {maxRank:5, days:2}", () => {
    // day1=600 (breaks tier500) | days2-13 (12d)=300 (tier500 only, breaks
    // tier10/50/100) | days14-19 (6d)=8 (tier10, extends to 8 with the
    // last 2) | days20-21 (2d)=3 (tier5).
    const ranks = [600, ...Array(12).fill(300), ...Array(6).fill(8), ...Array(2).fill(3)];
    const history = historyFromRanks(ranks);
    // Sanity-check the per-tier `current` values the example is stated in
    // terms of, so this test fails loudly if the fixture itself drifts.
    expect(computeDailyRankStreakCurrent(history, 5)).toBe(2);
    expect(computeDailyRankStreakCurrent(history, 10)).toBe(8);
    expect(computeDailyRankStreakCurrent(history, 500)).toBe(20);
    expect(pickBestRankStreak(history, TIERS)).toEqual({ maxRank: 5, days: 2 });
  });

  it("[confirmed] Top5=1, Top10=8 -> {maxRank:10, days:8}", () => {
    // day1=50 (breaks tier10) | days2-8 (7d)=7 (tier10 only) | day9=4
    // (tier5 too, but alone -> tier5 current=1, not enough).
    const ranks = [50, ...Array(7).fill(7), 4];
    const history = historyFromRanks(ranks);
    expect(computeDailyRankStreakCurrent(history, 5)).toBe(1);
    expect(computeDailyRankStreakCurrent(history, 10)).toBe(8);
    expect(pickBestRankStreak(history, TIERS)).toEqual({ maxRank: 10, days: 8 });
  });

  it("[confirmed] Top10=1, Top50=1, Top500=20 -> {maxRank:500, days:20}", () => {
    // day1=600 (breaks tier500) | days2-19 (18d)=300 (tier500 only) |
    // day20=150 (tier500 only, also breaks tier10/50/100 right before the
    // last day) | day21=8 (tier10/50/100 too, but alone -> current=1 each).
    const ranks = [600, ...Array(18).fill(300), 150, 8];
    const history = historyFromRanks(ranks);
    expect(computeDailyRankStreakCurrent(history, 10)).toBe(1);
    expect(computeDailyRankStreakCurrent(history, 50)).toBe(1);
    expect(computeDailyRankStreakCurrent(history, 500)).toBe(20);
    expect(pickBestRankStreak(history, TIERS)).toEqual({ maxRank: 500, days: 20 });
  });

  it("[confirmed] every tier current<=1 -> null", () => {
    // A single data point: current=1 at every tier it qualifies for at all
    // (rank=3 qualifies all 5 tiers), none reach 2.
    const history = historyFromRanks([3]);
    for (const tier of TIERS) {
      expect(computeDailyRankStreakCurrent(history, tier)).toBeLessThanOrEqual(1);
    }
    expect(pickBestRankStreak(history, TIERS)).toBeNull();
  });

  it("[boundary] current=2 is adopted", () => {
    // day1=600 (breaks tier500); days2-3=500 (tier500 only, current=2).
    const history = historyFromRanks([600, 500, 500]);
    expect(computeDailyRankStreakCurrent(history, 500)).toBe(2);
    expect(pickBestRankStreak(history, TIERS)).toEqual({ maxRank: 500, days: 2 });
  });

  it("[boundary] current=1 is NOT adopted", () => {
    // day1=600 (breaks tier500); day2=500 alone -> tier500 current=1.
    const history = historyFromRanks([600, 500]);
    expect(computeDailyRankStreakCurrent(history, 500)).toBe(1);
    expect(pickBestRankStreak(history, TIERS)).toBeNull();
  });

  it("picks the strictest tier when its current streak already reaches 2+ days", () => {
    // 07-07 breaks tier5 (50>5); 07-08..07-10 are all <=5, consecutive -> 3.
    const history = [
      { snapshotDate: "2026-07-07", dailyRank: 50 },
      { snapshotDate: "2026-07-08", dailyRank: 4 },
      { snapshotDate: "2026-07-09", dailyRank: 3 },
      { snapshotDate: "2026-07-10", dailyRank: 2 },
    ];
    expect(pickBestRankStreak(history, TIERS)).toEqual({ maxRank: 5, days: 3 });
  });

  it("falls through to a looser tier when the strictest tier doesn't qualify", () => {
    // tier5 current = 0 (both recent days >5); tier10 current = 2 (exact
    // boundary — the minimum that still counts).
    const history = [
      { snapshotDate: "2026-07-08", dailyRank: 40 },
      { snapshotDate: "2026-07-09", dailyRank: 8 },
      { snapshotDate: "2026-07-10", dailyRank: 7 },
    ];
    expect(pickBestRankStreak(history, TIERS)).toEqual({ maxRank: 10, days: 2 });
  });

  it("keeps falling through until a looser tier qualifies", () => {
    // tier5/tier10 both current = 0; tier50 current = 2.
    const history = [
      { snapshotDate: "2026-07-09", dailyRank: 45 },
      { snapshotDate: "2026-07-10", dailyRank: 42 },
    ];
    expect(pickBestRankStreak(history, TIERS)).toEqual({ maxRank: 50, days: 2 });
  });

  it("is unaffected by the tiers array's input order (always tries strictest first)", () => {
    const history = [
      { snapshotDate: "2026-07-07", dailyRank: 50 },
      { snapshotDate: "2026-07-08", dailyRank: 4 },
      { snapshotDate: "2026-07-09", dailyRank: 3 },
      { snapshotDate: "2026-07-10", dailyRank: 2 },
    ];
    expect(pickBestRankStreak(history, [500, 100, 50, 10, 5])).toEqual({ maxRank: 5, days: 3 });
  });

  it("returns null (hide the stat) when no tier's current streak reaches 2 days", () => {
    // A single day within only the loosest tier: current = 1 everywhere it
    // qualifies at all, which isn't enough.
    const history = [{ snapshotDate: "2026-07-10", dailyRank: 300 }];
    expect(pickBestRankStreak(history, TIERS)).toBeNull();
  });

  it("returns null for an empty/no-data history rather than throwing", () => {
    expect(pickBestRankStreak([], TIERS)).toBeNull();
    expect(pickBestRankStreak(undefined, TIERS)).toBeNull();
  });
});
