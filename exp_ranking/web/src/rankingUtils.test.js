import { describe, expect, it } from "vitest";
import { arrivalDatePartsFromSnapshot } from "./rankingUtils.js";

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
