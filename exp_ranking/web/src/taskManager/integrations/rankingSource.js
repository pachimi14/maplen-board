export const DEFAULT_RANKING_URL = "https://lulumi-tools.com/data/v2/rankings.json";

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeRankingPayload(payload) {
  const meta = payload?.meta || {};
  if (meta.dataFormatVersion !== 2 || !Array.isArray(payload?.characters)) {
    return { ok: false, code: "invalidFormat", characters: [], meta: {} };
  }
  const characters = payload.characters
    .filter((row) => typeof row?.historyKey === "string" && row.historyKey.length > 0)
    .map((row) => ({
      historyKey: row.historyKey,
      name: typeof row.name === "string" ? row.name : row.historyKey,
      job: typeof row.job === "string" ? row.job : "",
      worldId: typeof row.worldId === "string" ? row.worldId : "",
      imageUrl: typeof row.imageUrl === "string" ? row.imageUrl : "",
      characterAssetKey: typeof row.characterAssetKey === "string" ? row.characterAssetKey : "",
      navigatorUrl: typeof row.navigatorUrl === "string" ? row.navigatorUrl : "",
      level: finite(row.level),
      exp: typeof row.exp === "string" || Number.isSafeInteger(row.exp) ? String(row.exp) : "",
      totalExpFrom240: typeof row.totalExpFrom240 === "string" || Number.isSafeInteger(row.totalExpFrom240)
        ? String(row.totalExpFrom240)
        : "",
      levelExpPercent: finite(row.levelExpPercent ?? row.expPercent),
      dailyGain: finite(row.dailyGain),
      rank: Number.isFinite(row.rank) ? row.rank : null,
    }));
  return {
    ok: true,
    code: "ok",
    characters,
    meta: {
      dataFormatVersion: 2,
      latestSnapshotDate: typeof meta.latestSnapshotDate === "string" ? meta.latestSnapshotDate : "",
      updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : "",
      expTable: meta.expTable && typeof meta.expTable === "object" ? meta.expTable : {},
      dailyPeriodEnd: typeof meta.gainPeriods?.daily?.periodEnd === "string"
        ? meta.gainPeriods.daily.periodEnd
        : "",
    },
  };
}

export function createRankingSource({
  url = DEFAULT_RANKING_URL,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  let cached = null;
  let pending = null;
  return {
    async load({ force = false } = {}) {
      if (!force && cached) return cached;
      if (!force && pending) return pending;
      pending = (async () => {
        try {
          const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
          if (!response.ok) return { ok: false, code: "httpError", characters: [], meta: {} };
          const result = normalizeRankingPayload(await response.json());
          if (result.ok) cached = result;
          return result;
        } catch {
          return { ok: false, code: "networkError", characters: [], meta: {} };
        } finally {
          pending = null;
        }
      })();
      return pending;
    },
  };
}

export const rankingSource = createRankingSource();
