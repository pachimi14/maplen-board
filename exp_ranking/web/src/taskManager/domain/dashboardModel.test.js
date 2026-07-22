import { describe, expect, it } from "vitest";
import { addDashboardCharacter, claimLegacyDailyExpGoal, dailyExpGoalProgress, dailyExpGoalRemaining, getDailyExpGoal, normalizeDashboardState, parseDailyExpGoal, removeDashboardCharacter, setDailyExpGoal, setDashboardThemeColor, setDashboardThemeDepth } from "./dashboardModel.js";

describe("daily EXP goal", () => {
  it.each([["500", "500000000000"], ["1.5", "1500000000"], ["1,234", "1234000000000"]])("parses %s exactly", (input, expected) => {
    expect(parseDailyExpGoal(input)).toBe(expected);
  });
  it.each(["", "0", "500B", "abc", "-10"])("rejects %s", (input) => expect(parseDailyExpGoal(input)).toBeNull());
  it("migrates the old single-character goal to the primary character", () => {
    const migrated = normalizeDashboardState({ schemaVersion: 1, reminderMemo: "memo", dailyExpGoal: "500000000000" });
    expect(migrated).toMatchObject({ schemaVersion: 3, reminderMemo: "memo", dailyExpGoals: {}, legacyDailyExpGoal: "500000000000", characterHistoryKeys: [] });
    expect(getDailyExpGoal(claimLegacyDailyExpGoal(migrated, "char-a"), "char-a")).toBe("500000000000");
  });
  it("stores daily goals independently for each character", () => {
    const first = setDailyExpGoal({ schemaVersion: 2 }, "char-a", "500000000000");
    const second = setDailyExpGoal(first, "char-b", "300000000000");
    expect(getDailyExpGoal(second, "char-a")).toBe("500000000000");
    expect(getDailyExpGoal(second, "char-b")).toBe("300000000000");
  });
  it("normalizes the four colors and three depth levels", () => {
    for (const color of ["green", "blue", "purple", "orange"]) {
      expect(setDashboardThemeColor({ schemaVersion: 2 }, color).themeColor).toBe(color);
    }
    for (const depth of ["light", "standard", "deep"]) {
      expect(setDashboardThemeDepth({ schemaVersion: 2 }, depth).themeDepth).toBe(depth);
    }
  });
  it("migrates legacy pastel themes to the matching light color", () => {
    expect(normalizeDashboardState({ schemaVersion: 2, theme: "lavender" })).toMatchObject({ themeColor: "purple", themeDepth: "light" });
  });
  it("calculates progress without floating point EXP math", () => {
    expect(dailyExpGoalProgress("316230000000", "500000000000")).toBe(63.24);
    expect(dailyExpGoalProgress("600", "500")).toBe(120);
    expect(dailyExpGoalRemaining("316230000000", "500000000000")).toBe("183770000000");
    expect(dailyExpGoalRemaining("600", "500")).toBe("0");
  });
});


describe("dashboard characters", () => {
  it("stores at most two distinct history keys", () => {
    const first = addDashboardCharacter({ schemaVersion: 3 }, "char-a");
    const second = addDashboardCharacter(first.state, "char-b");
    expect(second.state.characterHistoryKeys).toEqual(["char-a", "char-b"]);
    expect(addDashboardCharacter(second.state, "char-c")).toMatchObject({ ok: false, code: "limitReached" });
    expect(addDashboardCharacter(second.state, "char-a")).toMatchObject({ ok: false, code: "alreadyPinned" });
  });
  it("removes a dashboard character without changing ranking profile data", () => {
    const state = { schemaVersion: 3, characterHistoryKeys: ["char-a", "char-b"] };
    expect(removeDashboardCharacter(state, "char-a").state.characterHistoryKeys).toEqual(["char-b"]);
  });
});
