import { describe, expect, it } from "vitest";
import { createProfileCharacterSource, createStaticCharacterSource, normalizeCharacters } from "./characterSource.js";

describe("optional character source", () => {
  it("returns an empty list when ranking/profile data is unavailable", async () => {
    expect(await createStaticCharacterSource().load()).toEqual([]);
    expect(await createProfileCharacterSource({ getItem() { throw new Error("blocked"); } }).load()).toEqual([]);
  });

  it("normalizes and deduplicates by historyKey, never by name", () => {
    expect(normalizeCharacters([
      { historyKey: "asset:a", name: "Same" },
      { historyKey: "asset:b", name: "Same" },
      { historyKey: "asset:a", name: "Renamed" },
    ])).toEqual([
      { historyKey: "asset:a", name: "Same", job: "", worldId: "", imageUrl: "" },
      { historyKey: "asset:b", name: "Same", job: "", worldId: "", imageUrl: "" },
    ]);
  });
});
