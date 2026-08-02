import { describe, expect, it } from "vitest";
import { createRaffleSource } from "./raffleSource.js";

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "" },
    async json() {
      return body;
    },
  };
}

function job(status) {
  return {
    schemaVersion: 3,
    classificationVersion: 1,
    status,
    progress: {
      completedCharacters: status === "complete" ? 1 : 0,
      totalCharacters: 1,
      stage: status,
      elapsedMs: 1,
    },
    raffleResults: [],
    clears: [],
    warnings: [],
    errors: [],
  };
}

describe("raffleSource", () => {
  it("creates and polls a job to completion", async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push([url, options.method || "GET"]);
      if (url.endsWith("/jobs")) return response(202, { jobId: "opaque" });
      return response(200, job("complete"));
    };
    const source = createRaffleSource({
      baseUrl: "https://example.test",
      fetchImpl,
      pollIntervalMs: 0,
    });
    const result = await source.runJob({
        raffledAt: "2026-07-30T00:00:00Z",
      characters: [{ memberId: "m1", assetKey: "CHARabc" }],
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      ["https://example.test/raffle/v1/jobs", "POST"],
      ["https://example.test/raffle/v1/jobs/opaque", "GET"],
    ]);
  });

  it("returns a fail-visible network error", async () => {
    const source = createRaffleSource({
      baseUrl: "https://example.test",
      fetchImpl: async () => {
        throw new TypeError("offline");
      },
    });
    await expect(source.createJob({})).resolves.toEqual({ ok: false, code: "networkError" });
  });
  it("maps 429 without exposing the upstream body", async () => {
    const source = createRaffleSource({
      baseUrl: "https://example.test",
      fetchImpl: async () => response(429, { secret: "not returned" }),
    });
    const result = await source.createJob({});
    expect(result).toMatchObject({ ok: false, code: "rateLimited", status: 429 });
    expect(result.data).toBeUndefined();
  });

  it("searches characters through the raffle API without exposing an API key", async () => {
    const calls = [];
    const source = createRaffleSource({
      baseUrl: "https://example.test",
      fetchImpl: async (url, options = {}) => {
        calls.push([url, JSON.parse(options.body)]);
        return response(200, {
          schemaVersion: 3,
          query: "pachimi",
          results: [{ assetKey: "CHARfixture001", displayName: "pachimi" }],
        });
      },
    });
    const result = await source.searchCharacters("pachimi");
    expect(result.ok).toBe(true);
    expect(result.data.results[0].displayName).toBe("pachimi");
    expect(calls).toEqual([
      ["https://example.test/raffle/v1/characters/search", { query: "pachimi" }],
    ]);
  });});