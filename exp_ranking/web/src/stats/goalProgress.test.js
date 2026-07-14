import { describe, expect, it } from "vitest";
import { computeGoalProgress } from "./goalProgress.js";

// expTable: every level from 230..239 costs 1000 EXP to clear.
const expTable = {};
for (let lvl = 230; lvl < 240; lvl += 1) {
  expTable[lvl] = 1000;
}

// level=230, 0 EXP into the current level, one history point supplying the
// default todayIso (2026-07-10). remainingExpToLevel(target=232) = 2000
// (1000 left in 230 + 1000 for level 231).
const character = {
  level: 230,
  exp: 0,
  history: [{ snapshotDate: "2026-07-10", dailyGain: 100 }],
};

describe("computeGoalProgress", () => {
  it("classifies ahead when the estimated arrival is before the target date", () => {
    const result = computeGoalProgress(
      character,
      expTable,
      { targetLevel: 232, targetDateIso: "2026-08-15" },
      { averageDailyGain: 100 }
    );
    // daysToArrive = ceil(2000/100) = 20 -> estimatedArrivalDate = 2026-07-30
    // daysUntilTarget (07-10 -> 08-15) = 36 -> daysDelta = 36 - 20 = 16 > 0
    expect(result.remainingExp).toBe(2000);
    expect(result.daysUntilTarget).toBe(36);
    expect(result.estimatedArrivalDate).toBe("2026-07-30");
    expect(result.daysDelta).toBe(16);
    expect(result.requiredDailyGain).toBe(Math.ceil(2000 / 36));
    expect(result.status).toBe("ahead");
  });

  it("classifies behind when the estimated arrival is after the target date", () => {
    const result = computeGoalProgress(
      character,
      expTable,
      { targetLevel: 232, targetDateIso: "2026-07-20" },
      { averageDailyGain: 100 }
    );
    // daysUntilTarget (07-10 -> 07-20) = 10, daysToArrive = 20 -> delta = -10
    expect(result.daysUntilTarget).toBe(10);
    expect(result.daysDelta).toBe(-10);
    expect(result.requiredDailyGain).toBe(200);
    expect(result.status).toBe("behind");
  });

  it("classifies onTrack when daysDelta is exactly 0", () => {
    const result = computeGoalProgress(
      character,
      expTable,
      { targetLevel: 232, targetDateIso: "2026-07-30" },
      { averageDailyGain: 100 }
    );
    expect(result.daysUntilTarget).toBe(20);
    expect(result.estimatedArrivalDate).toBe("2026-07-30");
    expect(result.daysDelta).toBe(0);
    expect(result.status).toBe("onTrack");
  });

  it("classifies achieved when the character already meets targetLevel", () => {
    const achievedCharacter = { ...character, level: 232 };
    const result = computeGoalProgress(
      achievedCharacter,
      expTable,
      { targetLevel: 232, targetDateIso: "2026-08-15" },
      { averageDailyGain: 100 }
    );
    expect(result.status).toBe("achieved");
    expect(result.remainingExp).toBe(0);
  });

  it("classifies insufficientData for a missing/zero/negative averageDailyGain", () => {
    const goal = { targetLevel: 232, targetDateIso: "2026-08-15" };
    expect(computeGoalProgress(character, expTable, goal, {}).status).toBe("insufficientData");
    expect(computeGoalProgress(character, expTable, goal, { averageDailyGain: null }).status).toBe(
      "insufficientData"
    );
    expect(computeGoalProgress(character, expTable, goal, { averageDailyGain: 0 }).status).toBe(
      "insufficientData"
    );
    expect(computeGoalProgress(character, expTable, goal, { averageDailyGain: -5 }).status).toBe(
      "insufficientData"
    );
  });

  it("classifies insufficientData for an invalid targetLevel", () => {
    expect(
      computeGoalProgress(
        character,
        expTable,
        { targetLevel: "not-a-level", targetDateIso: "2026-08-15" },
        { averageDailyGain: 100 }
      ).status
    ).toBe("insufficientData");
    expect(
      computeGoalProgress(
        character,
        expTable,
        { targetLevel: 999, targetDateIso: "2026-08-15" },
        { averageDailyGain: 100 }
      ).status
    ).toBe("insufficientData");
  });

  it("classifies insufficientData for an unparseable targetDateIso", () => {
    const result = computeGoalProgress(
      character,
      expTable,
      { targetLevel: 232, targetDateIso: "not-a-date" },
      { averageDailyGain: 100 }
    );
    expect(result.status).toBe("insufficientData");
    expect(result.targetDate).toBeNull();
  });

  it("classifies behind (with structural values) for a past target date", () => {
    const result = computeGoalProgress(
      character,
      expTable,
      { targetLevel: 232, targetDateIso: "2026-07-01" },
      { averageDailyGain: 100 }
    );
    expect(result.daysUntilTarget).toBeLessThanOrEqual(0);
    expect(result.status).toBe("behind");
    expect(result.requiredDailyGain).toBeNull();
    expect(result.remainingExp).toBe(2000);
    expect(result.estimatedArrivalDate).toBe("2026-07-30");
  });

  it("uses an injected todayIso instead of the history default", () => {
    const result = computeGoalProgress(
      character,
      expTable,
      { targetLevel: 232, targetDateIso: "2026-08-15" },
      { averageDailyGain: 100, todayIso: "2026-07-01" }
    );
    // daysToArrive = 20 -> arrival = 2026-07-21; daysUntilTarget (07-01 -> 08-15) = 45
    expect(result.estimatedArrivalDate).toBe("2026-07-21");
    expect(result.daysUntilTarget).toBe(45);
    expect(result.daysDelta).toBe(25);
    expect(result.status).toBe("ahead");
  });
});
