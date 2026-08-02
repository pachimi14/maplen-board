import { describe, expect, it } from "vitest";
import { parseNavigatorCharacterUrl } from "./assetInput.js";

describe("parseNavigatorCharacterUrl", () => {
  it("accepts only the canonical Navigator character URL", () => {
    expect(
      parseNavigatorCharacterUrl("https://msu.io/navigator/character/CHARfixture001"),
    ).toEqual({ ok: true, assetKey: "CHARfixture001" });
  });

  it("rejects raw asset keys, lookalike hosts, and unrelated paths", () => {
    expect(parseNavigatorCharacterUrl("CHARfixture001").ok).toBe(false);
    expect(parseNavigatorCharacterUrl("https://evil.example/navigator/character/CHARfixture001").ok).toBe(false);
    expect(parseNavigatorCharacterUrl("https://msu.io/market/CHARfixture001").ok).toBe(false);
  });
});