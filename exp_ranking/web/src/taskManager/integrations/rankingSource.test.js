import { describe, expect, it, vi } from "vitest";
import { createRankingSource, normalizeRankingPayload } from "./rankingSource.js";

const payload = {
  meta: {
    dataFormatVersion: 2,
    latestSnapshotDate: "2026-07-19",
    updatedAt: "2026-07-20T00:28:19Z",
    expTable: { 250: 1000 },
    gainPeriods: { daily: { periodEnd: "2026-07-19" } },
  },
  characters: [{
    historyKey: "asset:A",
    name: "Alice",
    job: "Bishop",
    worldId: "Ain",
    level: 250,
    exp: 456,
    totalExpFrom240: 123456,
    levelExpPercent: 12.5,
    dailyGain: 123,
    rank: 10,
    characterAssetKey: "CHAR_A",
    navigatorUrl: "https://msu.io/navigator/character/CHAR_A",
  }],
};

describe("rankingSource", () => {
  it("normalizes only dashboard fields and retains historyKey", () => {
    const result = normalizeRankingPayload(payload);
    expect(result.ok).toBe(true);
    expect(result.characters[0]).toMatchObject({
      historyKey: "asset:A", name: "Alice", levelExpPercent: 12.5, dailyGain: 123,
      exp: "456", totalExpFrom240: "123456",
      characterAssetKey: "CHAR_A", navigatorUrl: "https://msu.io/navigator/character/CHAR_A",
    });
    expect(result.meta.dailyPeriodEnd).toBe("2026-07-19");
    expect(result.meta.expTable).toEqual({ 250: 1000 });
  });

  it("returns a soft error instead of throwing when fetch fails", async () => {
    const source = createRankingSource({ fetchImpl: vi.fn().mockRejectedValue(new Error("offline")) });
    await expect(source.load()).resolves.toEqual({
      ok: false, code: "networkError", characters: [], meta: {},
    });
  });

  it("caches a successful payload in memory", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    const source = createRankingSource({ fetchImpl });
    await source.load();
    await source.load();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
