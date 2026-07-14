import { describe, expect, it } from "vitest";
import {
  classifyHistoryAvailability,
  errorMessageKeyForCode,
  isLatestDateToday,
  limitWithOthers,
  rankMovementDirection,
  resolveDisplayedHistoryKey,
  roundPercent,
} from "./myCharacterUtils.js";

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
  it("reports loading/failed from the caller-tracked fetch status first", () => {
    expect(classifyHistoryAvailability(undefined, "loading")).toBe("loading");
    expect(classifyHistoryAvailability([], "failed")).toBe("failed");
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
