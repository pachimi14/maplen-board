import { describe, expect, it } from "vitest";
import { calculateAverageDailyGain } from "./gainPace.js";

const day = (snapshotDate, dailyGain) => ({ snapshotDate, dailyGain });

describe("calculateAverageDailyGain", () => {
  it("averages a 7-day window ending at the latest confirmed date by default", () => {
    const history = [
      day("2026-07-01", 10),
      day("2026-07-02", 20),
      day("2026-07-03", 0),
      day("2026-07-04", 30),
      day("2026-07-05", 40),
      day("2026-07-06", 50),
      day("2026-07-07", 60),
    ];
    // sum = 10+20+0+30+40+50+60 = 210, count = 7 -> 30
    expect(calculateAverageDailyGain(history, { days: 7 })).toBe(30);
  });

  it("includes 0-gain days in the average (lowers it) but excludes null/negative", () => {
    const withZero = [day("2026-07-01", 0), day("2026-07-02", 10)];
    expect(calculateAverageDailyGain(withZero, { days: 2, endDate: "2026-07-02" })).toBe(5);

    const withNull = [day("2026-07-01", null), day("2026-07-02", 10)];
    // Only 07-02 is comparable: count=1, sum=10 -> 10 (not 5).
    expect(calculateAverageDailyGain(withNull, { days: 2, endDate: "2026-07-02" })).toBe(10);

    const withNegative = [day("2026-07-01", -5), day("2026-07-02", 10)];
    expect(calculateAverageDailyGain(withNegative, { days: 2, endDate: "2026-07-02" })).toBe(10);
  });

  it("does not count a missing calendar day in the denominator", () => {
    const history = [
      day("2026-07-01", 10),
      // 07-02 missing entirely
      day("2026-07-03", 20),
    ];
    // window [07-01, 07-03]: 2 present points, sum=30, count=2 -> 15 (not /3).
    expect(calculateAverageDailyGain(history, { days: 3, endDate: "2026-07-03" })).toBe(15);
  });

  it("uses an explicit endDate, and falls back to the default when endDate is invalid", () => {
    const history = [day("2026-07-01", 10), day("2026-07-02", 20), day("2026-07-03", 30)];

    expect(calculateAverageDailyGain(history, { days: 2, endDate: "2026-07-02" })).toBe(15);

    // Malformed endDate falls back to the default (latest snapshotDate = 07-03).
    expect(calculateAverageDailyGain(history, { days: 1, endDate: "not-a-date" })).toBe(30);
  });

  it("returns null for a non-positive days window, and when no day is comparable", () => {
    const history = [day("2026-07-01", 10)];
    expect(calculateAverageDailyGain(history, { days: 0 })).toBeNull();
    expect(calculateAverageDailyGain(history, { days: -3 })).toBeNull();

    const allExcluded = [day("2026-07-01", null), day("2026-07-02", -5)];
    expect(calculateAverageDailyGain(allExcluded, { days: 2, endDate: "2026-07-02" })).toBeNull();
  });

  it("is order-independent and folds duplicate snapshotDate by the C normalization rule", () => {
    const inOrder = [day("2026-07-01", 10), day("2026-07-02", 20), day("2026-07-03", 30)];
    const shuffled = [inOrder[2], inOrder[0], inOrder[1]];
    const expected = calculateAverageDailyGain(inOrder, { days: 3, endDate: "2026-07-03" });
    expect(calculateAverageDailyGain(shuffled, { days: 3, endDate: "2026-07-03" })).toBe(expected);

    // Duplicate 07-02: the higher dailyGain (50) must win the dedup, not 5.
    const withDuplicate = [
      day("2026-07-01", 10),
      day("2026-07-02", 5),
      day("2026-07-02", 50),
      day("2026-07-03", 30),
    ];
    // sum = 10 + 50 + 30 = 90, count = 3 -> 30
    expect(calculateAverageDailyGain(withDuplicate, { days: 3, endDate: "2026-07-03" })).toBe(30);
  });
});
