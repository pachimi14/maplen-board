import { describe, expect, it } from "vitest";
import { isDisplayableWorldId } from "./worldDisplay.js";

describe("isDisplayableWorldId", () => {
  it("shows readable ranking world names", () => {
    expect(isDisplayableWorldId("Ain")).toBe(true);
    expect(isDisplayableWorldId("Fang")).toBe(true);
    expect(isDisplayableWorldId("Errai")).toBe(true);
  });

  it("hides opaque numeric API world ids", () => {
    expect(isDisplayableWorldId("2")).toBe(false);
    expect(isDisplayableWorldId("10")).toBe(false);
    expect(isDisplayableWorldId("0")).toBe(false);
  });

  it("hides empty/missing/whitespace-only/non-string values", () => {
    expect(isDisplayableWorldId("")).toBe(false);
    expect(isDisplayableWorldId("   ")).toBe(false);
    expect(isDisplayableWorldId(undefined)).toBe(false);
    expect(isDisplayableWorldId(null)).toBe(false);
  });

  it("trims surrounding whitespace before judging", () => {
    expect(isDisplayableWorldId("  Ain  ")).toBe(true);
    expect(isDisplayableWorldId("  2  ")).toBe(false);
  });
});
