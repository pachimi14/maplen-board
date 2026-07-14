import { describe, expect, it } from "vitest";
import { arrivalDatePartsForDailyRuns } from "./rankingUtils.js";

// Dummy translator: arrivalDatePartsForDailyRuns/targetDatePartsAfterDays
// only need rawYear/rawMonth/rawDay for these tests (the translated
// year/monthDay strings are exercised elsewhere via the app's real i18n).
const t = (key, params) => `${key}:${JSON.stringify(params ?? {})}`;

describe("arrivalDatePartsForDailyRuns (T4b §22.11 B)", () => {
  it("treats today as day 1 of the run: days=11 lands on today+10, not today+11", () => {
    // JST today = 2026-07-14 (00:00 UTC == 09:00 JST, same calendar day).
    const reference = new Date("2026-07-14T00:00:00Z");
    const parts = arrivalDatePartsForDailyRuns(11, t, reference);
    expect(parts.rawYear).toBe(2026);
    expect(parts.rawMonth).toBe(7);
    expect(parts.rawDay).toBe(24); // 7/14 (day1) ... 7/24 (day11)
  });

  it("days=1 arrives today (the run's first and only day)", () => {
    const reference = new Date("2026-07-14T00:00:00Z");
    const parts = arrivalDatePartsForDailyRuns(1, t, reference);
    expect(parts.rawYear).toBe(2026);
    expect(parts.rawMonth).toBe(7);
    expect(parts.rawDay).toBe(14);
  });

  it("crosses a month boundary correctly", () => {
    const reference = new Date("2026-07-30T00:00:00Z");
    const parts = arrivalDatePartsForDailyRuns(5, t, reference);
    // day1=7/30, day2=7/31, day3=8/1, day4=8/2, day5=8/3
    expect(parts.rawYear).toBe(2026);
    expect(parts.rawMonth).toBe(8);
    expect(parts.rawDay).toBe(3);
  });

  it("returns null for a 0-or-fewer day plan (guard, no such arrival date)", () => {
    const reference = new Date("2026-07-14T00:00:00Z");
    expect(arrivalDatePartsForDailyRuns(0, t, reference)).toBeNull();
    expect(arrivalDatePartsForDailyRuns(-3, t, reference)).toBeNull();
  });

  it("returns null for non-finite/missing days rather than throwing", () => {
    const reference = new Date("2026-07-14T00:00:00Z");
    expect(arrivalDatePartsForDailyRuns(null, t, reference)).toBeNull();
    expect(arrivalDatePartsForDailyRuns(undefined, t, reference)).toBeNull();
    expect(arrivalDatePartsForDailyRuns(NaN, t, reference)).toBeNull();
  });
});
