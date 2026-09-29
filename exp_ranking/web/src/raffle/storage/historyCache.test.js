import { describe, expect, it } from "vitest";
import { loadRaffleHistoryCache, saveRaffleHistoryCache } from "./historyCache.js";
import { RAFFLE_CLASSIFICATION_VERSION, RAFFLE_SCHEMA_VERSION } from "../domain/contract.js";

function backend() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function payload() {
  return {
    schemaVersion: RAFFLE_SCHEMA_VERSION,
    classificationVersion: RAFFLE_CLASSIFICATION_VERSION,
    status: "complete",
    progress: { completedCharacters: 1, totalCharacters: 1, stage: "complete", elapsedMs: 10 },
    raffleResults: [], clears: [], warnings: [], errors: [], memberWallets: {},
  };
}

describe("raffle history cache", () => {
  it("returns the same-party same-round result until the next Thursday reset", () => {
    const storage = backend();
    const round = "2026-09-24T00:00:00Z";
    const savedAt = Date.parse(round) + 1000;
    const resetAt = Date.parse("2026-10-01T00:00:00Z");
    expect(saveRaffleHistoryCache(round, ["CHARb", "CHARa"], payload(), { backend: storage, now: savedAt }).ok).toBe(true);
    const loaded = loadRaffleHistoryCache(round, ["CHARa", "CHARb"], { backend: storage, now: resetAt - 1 });
    expect(loaded.ok).toBe(true);
    expect(loaded.savedAt).toBe(savedAt);
  });

  it("misses at the Thursday reset or when the round changes", () => {
    const storage = backend();
    const round = "2026-09-24T00:00:00Z";
    saveRaffleHistoryCache(round, ["CHARa"], payload(), { backend: storage, now: Date.parse(round) + 1000 });
    expect(loadRaffleHistoryCache(round, ["CHARa"], { backend: storage, now: Date.parse("2026-10-01T00:00:00Z") }).ok).toBe(false);
    expect(loadRaffleHistoryCache("2026-10-01T00:00:00Z", ["CHARa"], { backend: storage, now: Date.parse(round) + 2000 }).ok).toBe(false);
  });
});
