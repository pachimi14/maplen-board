import { describe, expect, it } from "vitest";
import {
  getCustomResetSnapshot,
  getCycleKey,
  getDailyCycleKey,
  getNextDailyReset,
  getNextWeeklyReset,
  getResetSnapshot,
  getWeeklyCycleKey,
} from "./reset.js";

describe("UTC reset boundaries", () => {
  it("changes the daily cycle exactly at 00:00 UTC", () => {
    expect(getDailyCycleKey("2026-07-20T23:59:59.999Z")).toBe("day:2026-07-20");
    expect(getDailyCycleKey("2026-07-21T00:00:00.000Z")).toBe("day:2026-07-21");
    expect(getNextDailyReset("2026-07-21T00:00:00.000Z").toISOString()).toBe("2026-07-22T00:00:00.000Z");
  });

  it("changes the weekly cycle at Thursday 00:00 UTC", () => {
    expect(getWeeklyCycleKey("2026-07-22T23:59:59.999Z")).toBe("week:2026-07-16");
    expect(getWeeklyCycleKey("2026-07-23T00:00:00.000Z")).toBe("week:2026-07-23");
    expect(getNextWeeklyReset("2026-07-23T00:00:00.000Z").toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });
  it("reports Daily and Weekly remaining time from the same UTC boundaries", () => {
    const snapshot = getResetSnapshot("2026-07-20T12:00:00.000Z");
    expect(snapshot.daily.remainingMs).toBe(12 * 60 * 60 * 1000);
    expect(snapshot.weekly.remainingMs).toBe(60 * 60 * 60 * 1000);
  });

  it("supports no-reset, one-time, and repeating custom cycles at exact boundaries", () => {
    expect(getCycleKey("custom", "2026-07-21T00:00:00Z", { resetRule: { mode: "none" } })).toBe("custom:forever");
    const once = { resetRule: { mode: "once", firstAt: "2026-07-22T00:00:00Z" } };
    expect(getCycleKey("custom", "2026-07-21T23:59:59.999Z", once)).toContain("custom:before");
    expect(getCycleKey("custom", "2026-07-22T00:00:00.000Z", once)).toContain("custom:after");
    const repeating = { resetRule: { mode: "interval", firstAt: "2026-07-22T00:00:00Z", every: 2, unit: "day" } };
    expect(getCustomResetSnapshot("2026-07-21T00:00:00Z", repeating).remainingMs).toBe(24 * 60 * 60 * 1000);
    expect(getCycleKey("custom", "2026-07-22T00:00:00Z", repeating)).toContain(":1");
    expect(getCycleKey("custom", "2026-07-24T00:00:00Z", repeating)).toContain(":2");
  });});

