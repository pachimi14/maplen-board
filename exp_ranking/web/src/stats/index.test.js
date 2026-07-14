import { describe, expect, it } from "vitest";
import * as stats from "./index.js";

describe("stats public API", () => {
  it("re-exports every A-F function", () => {
    expect(typeof stats.calculateTopPercent).toBe("function");
    expect(typeof stats.computePassedAndOvertaken).toBe("function");
    expect(typeof stats.computePositiveGainStreak).toBe("function");
    expect(typeof stats.computeDailyRankStreak).toBe("function");
    expect(typeof stats.computeDailyGainSelfRank).toBe("function");
    expect(typeof stats.computeGoalProgress).toBe("function");
    expect(typeof stats.calculateAverageDailyGain).toBe("function");
  });
});
