import { describe, expect, it } from "vitest";
import { currentRaffleRoundUtc, raffleRoundResetAt } from "./raffleRound.js";

describe("currentRaffleRoundUtc", () => {
  it("uses the most recent Thursday 00:00 UTC", () => {
    expect(currentRaffleRoundUtc(new Date("2026-08-01T12:00:00Z"))).toBe("2026-07-30T00:00:00Z");
    expect(currentRaffleRoundUtc(new Date("2026-07-30T00:00:00Z"))).toBe("2026-07-30T00:00:00Z");
    expect(currentRaffleRoundUtc(new Date("2026-07-29T23:59:59Z"))).toBe("2026-07-23T00:00:00Z");
  });
});

describe("raffleRoundResetAt", () => {
  it("returns the following Thursday 00:00 UTC", () => {
    expect(new Date(raffleRoundResetAt("2026-07-30T00:00:00Z")).toISOString()).toBe("2026-08-06T00:00:00.000Z");
    expect(raffleRoundResetAt("invalid")).toBeNull();
  });
});
