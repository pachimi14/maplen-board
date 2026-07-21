export const DEFAULT_LIVE_EXP_BASE_URL = "https://api.lulumi-tools.com";

export function normalizeLiveExpPayload(payload, expectedKey) {
  if (payload?.schemaVersion !== 1 || payload?.characterAssetKey !== expectedKey) {
    return { ok: false, code: "invalidFormat" };
  }
  if (!Number.isInteger(payload.level) || !/^\d+$/.test(payload.exp || "") || !Number.isFinite(payload.levelExpPercent)) {
    return { ok: false, code: "invalidFormat" };
  }
  return {
    ok: true,
    code: "ok",
    data: {
      characterAssetKey: payload.characterAssetKey,
      level: payload.level,
      exp: payload.exp,
      expToNextLevel: /^\d+$/.test(payload.expToNextLevel || "") ? payload.expToNextLevel : "",
      levelExpPercent: payload.levelExpPercent,
      upstreamUpdatedAt: typeof payload.upstreamUpdatedAt === "string" ? payload.upstreamUpdatedAt : "",
      fetchedAt: typeof payload.fetchedAt === "string" ? payload.fetchedAt : "",
      stale: payload.stale === true,
    },
  };
}

export function createLiveExpSource({
  baseUrl = import.meta.env.VITE_LIVE_EXP_API_BASE || DEFAULT_LIVE_EXP_BASE_URL,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  return {
    async load(assetKey, { signal } = {}) {
      try {
        const response = await fetchImpl(`${baseUrl}/exp/live/${encodeURIComponent(assetKey)}`, {
          headers: { Accept: "application/json" }, signal,
        });
        if (!response.ok) return { ok: false, code: response.status === 429 ? "rateLimited" : "httpError" };
        return normalizeLiveExpPayload(await response.json(), assetKey);
      } catch (error) {
        return { ok: false, code: error?.name === "AbortError" ? "aborted" : "networkError" };
      }
    },
  };
}

export const liveExpSource = createLiveExpSource();
