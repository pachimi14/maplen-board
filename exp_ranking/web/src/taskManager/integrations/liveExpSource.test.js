import { describe, expect, it, vi } from "vitest";
import { createLiveExpSource, normalizeLiveExpPayload } from "./liveExpSource.js";

const payload = { schemaVersion: 1, characterAssetKey: "CHARabc", level: 252, exp: "123", expToNextLevel: "1000", levelExpPercent: 12.3, upstreamUpdatedAt: "2026-07-20T01:00:00Z", fetchedAt: "2026-07-20T01:00:01Z", stale: false };

describe("liveExpSource", () => {
  it("accepts only the requested character and decimal EXP", () => {
    expect(normalizeLiveExpPayload(payload, "CHARabc").ok).toBe(true);
    expect(normalizeLiveExpPayload({ ...payload, characterAssetKey: "CHARother" }, "CHARabc").ok).toBe(false);
    expect(normalizeLiveExpPayload({ ...payload, exp: "1.2" }, "CHARabc").ok).toBe(false);
  });

  it("uses the proxy route and soft-fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    const source = createLiveExpSource({ baseUrl: "https://api.example", fetchImpl });
    await expect(source.load("CHARabc")).resolves.toMatchObject({ ok: true, data: { exp: "123" } });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.example/exp/live/CHARabc");
  });
});
