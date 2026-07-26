import { describe, expect, it } from "vitest";
import { arrivalDatePartsFromSnapshot, remainingExpToLevel } from "./rankingUtils.js";

// Dummy translator: arrivalDatePartsFromSnapshot (via datePartsFromIsoDate/
// targetDatePartsAfterDays) only needs rawYear/rawMonth/rawDay for these
// tests (the translated year/monthDay strings are exercised elsewhere via
// the app's real i18n).
const t = (key, params) => `${key}:${JSON.stringify(params ?? {})}`;

describe("arrivalDatePartsFromSnapshot (T4b §22.14)", () => {
  // Fixed latest-snapshot date for every [confirmed] case below — the
  // production bug scenario: data is a day (or more) stale relative to
  // wall-clock "today", so the arrival date must be anchored to this
  // snapshot date, never to `reference`.
  const snapshot = "2026-07-13";

  it("[confirmed] N=1 -> 2026-07-14 (snapshot + 1, day 1 = the day after the snapshot)", () => {
    const parts = arrivalDatePartsFromSnapshot(snapshot, 1, t);
    expect(parts.rawYear).toBe(2026);
    expect(parts.rawMonth).toBe(7);
    expect(parts.rawDay).toBe(14);
  });

  it("[confirmed] N=5 -> 2026-07-18 (snapshot + 5, not wall-clock today + 5)", () => {
    // Production scenario: data=7/13末, wall-clock=7/15 JST. The old
    // today+(N-1) logic would have produced 7/19 here; snapshot+N is 7/18.
    const parts = arrivalDatePartsFromSnapshot(snapshot, 5, t, new Date("2026-07-15T00:00:00Z"));
    expect(parts.rawYear).toBe(2026);
    expect(parts.rawMonth).toBe(7);
    expect(parts.rawDay).toBe(18);
  });

  it("[confirmed] N=11 -> 2026-07-24 (snapshot + 11)", () => {
    const parts = arrivalDatePartsFromSnapshot(snapshot, 11, t);
    expect(parts.rawYear).toBe(2026);
    expect(parts.rawMonth).toBe(7);
    expect(parts.rawDay).toBe(24);
  });

  it("crosses a month boundary correctly", () => {
    const parts = arrivalDatePartsFromSnapshot("2026-07-30", 5, t);
    expect(parts.rawYear).toBe(2026);
    expect(parts.rawMonth).toBe(8);
    expect(parts.rawDay).toBe(4); // 7/30 + 5
  });

  it("returns null for a 0-or-fewer day plan (guard, no such arrival date)", () => {
    expect(arrivalDatePartsFromSnapshot(snapshot, 0, t)).toBeNull();
    expect(arrivalDatePartsFromSnapshot(snapshot, -3, t)).toBeNull();
  });

  it("returns null for non-finite/missing days rather than throwing", () => {
    expect(arrivalDatePartsFromSnapshot(snapshot, null, t)).toBeNull();
    expect(arrivalDatePartsFromSnapshot(snapshot, undefined, t)).toBeNull();
    expect(arrivalDatePartsFromSnapshot(snapshot, NaN, t)).toBeNull();
  });

  it("[fallback] falls back to wall-clock today+N when the snapshot date is missing", () => {
    const reference = new Date("2026-07-14T00:00:00Z"); // JST today = 2026-07-14
    const parts = arrivalDatePartsFromSnapshot(null, 5, t, reference);
    expect(parts.rawYear).toBe(2026);
    expect(parts.rawMonth).toBe(7);
    expect(parts.rawDay).toBe(19); // today(7/14) + 5, same convention as the milestone fallback
  });

  it("[fallback] falls back to wall-clock today+N when the snapshot date is an empty/invalid string", () => {
    const reference = new Date("2026-07-14T00:00:00Z");
    expect(arrivalDatePartsFromSnapshot("", 5, t, reference).rawDay).toBe(19);
    expect(arrivalDatePartsFromSnapshot("not-a-date", 5, t, reference).rawDay).toBe(19);
    expect(arrivalDatePartsFromSnapshot(undefined, 5, t, reference).rawDay).toBe(19);
  });
});

// LULU-062 basis 10: bot's mvp_export.py now reports levelExpPercent/
// expPercent unclamped (>100% for a real "wake-up" overshoot state -- see
// docs/IMPL_PLAN_exp-table-era.md). The planner's remaining-exp estimate
// must never go negative for such a character, on either of its two
// branches (raw exp present -- the always-taken path in production -- and
// the percent-only fallback). Both branches already guard with Math.max(
// ..., 0) (present since the function's original 2026-06-02 commit); this
// pins that guarantee down as a regression test now that >100% values are
// real, not just a theoretical input.
describe("remainingExpToLevel (LULU-062 basis 10: never negative for overshoot)", () => {
  const expTable = { 240: 1_000_000 };

  it("is 0, not negative, when raw exp already exceeds the table requirement (115% overshoot)", () => {
    const character = { level: 240, exp: 1_150_000 };
    expect(remainingExpToLevel(character, expTable, 250)).toBe(0);
  });

  it("is 0, not negative, when exp is missing and only an overshoot percent (>100) is available", () => {
    const character = { level: 240, exp: null, levelExpPercent: 115.4 };
    expect(remainingExpToLevel(character, expTable, 250)).toBe(0);
  });

  it("is 0, not negative, at the theoretical max overshoot (125% = 1/0.8, the table's 20% reduction)", () => {
    const rawExpCharacter = { level: 240, exp: 1_250_000 };
    const percentOnlyCharacter = { level: 240, exp: null, levelExpPercent: 125.0 };
    expect(remainingExpToLevel(rawExpCharacter, expTable, 250)).toBe(0);
    expect(remainingExpToLevel(percentOnlyCharacter, expTable, 250)).toBe(0);
  });
});
