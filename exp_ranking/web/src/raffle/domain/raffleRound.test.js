import { describe, expect, it } from "vitest";
import { currentRaffleRoundUtc } from "./raffleRound.js";

describe("currentRaffleRoundUtc", () => {
  it("uses the most recent Thursday 00:00 UTC", () => {
    expect(currentRaffleRoundUtc(new Date("2026-08-01T12:00:00Z"))).toBe("2026-07-30T00:00:00Z");
    expect(currentRaffleRoundUtc(new Date("2026-07-30T00:00:00Z"))).toBe("2026-07-30T00:00:00Z");
    expect(currentRaffleRoundUtc(new Date("2026-07-29T23:59:59Z"))).toBe("2026-07-23T00:00:00Z");
  });
});