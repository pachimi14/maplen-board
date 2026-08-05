// IMPL_PLAN_SH5 §1: same shape as taskManager/integrations/liveExpSource.js
// / rankingSource.js -- a factory returning `load*` methods, `fetchImpl`
// injectable for tests, base URL overridable by an env var for local dev
// against `server/sf-history/` (design §5.1's img-proxy precedent, same
// pattern the design doc calls "raffle/integrations/raffleSource.js と同型").
//
// design §10.2: preflight (`OPTIONS`) returns 405 on this service, so every
// request here MUST stay a CORS "simple request" -- no extra headers, no
// non-simple methods. Do not add an `Accept`/custom header "for cleanliness"
// without re-reading that section first.
export const DEFAULT_SF_HISTORY_API_BASE = "https://api.lulumi-tools.com";

function toFiniteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `/sf-history/equipment` -> the searchable equipment list (design §7:
 * representative itemId + display name + alias itemIds + data-derived
 * maxStar). Items without a resolvable `maxStar` are dropped rather than
 * guessed at (design §7.1: maxStar must never be hardcoded/assumed). */
export function normalizeEquipmentPayload(payload) {
  if (!payload || !Array.isArray(payload.items)) {
    return { ok: false, code: "invalidFormat", items: [] };
  }
  const items = payload.items
    .filter((row) => Number.isInteger(row?.itemId) && Number.isInteger(row?.maxStar) && row.maxStar > 0)
    .map((row) => ({
      itemId: row.itemId,
      itemName: typeof row.itemName === "string" && row.itemName ? row.itemName : String(row.itemId),
      aliasItemIds: Array.isArray(row.aliasItemIds) && row.aliasItemIds.length
        ? row.aliasItemIds.filter((id) => Number.isInteger(id))
        : [row.itemId],
      maxStar: row.maxStar,
    }));
  return { ok: true, code: "ok", items };
}

/** `/sf-history/prices?itemId=` -> the 4h-bucketed price series (design §10).
 *
 * IMPL_PLAN_SH7 §3-2: the server may append one trailing *provisional*
 * point (`point.provisional === true`) plus a top-level `provisionalDate`.
 * Both are passed straight through -- `domain/series.js`'s
 * `buildExpectedSeries` is what actually reads `point.provisional`
 * (SfHistoryChart / computeStats / currentPercentile downstream of that).
 * Without this pass-through the flag would be silently dropped here before
 * it ever reached the domain layer, and the provisional point would look
 * exactly like an ordinary confirmed one everywhere else in the app.
 *
 * IMPL_PLAN_SH8 §2-2: a provisional point may also carry `point.asOf` (the
 * official API's own as-of timestamp for the value, distinct from `date`,
 * the bucket-start draw position -- untouched). Passed through only when
 * present as a non-empty string; omitted otherwise so downstream code can
 * tell "no asOf" apart from an empty one without an extra null-vs-missing
 * check ("無い数字を発明しない" -- never invent a fallback value here).
 */
export function normalizePricesPayload(payload, expectedItemId) {
  if (!payload || payload.itemId !== expectedItemId || !Array.isArray(payload.points)) {
    return {
      ok: false,
      code: "invalidFormat",
      points: [],
      priceVersion: null,
      startDate: null,
      endDate: null,
      provisionalDate: null,
    };
  }
  const points = payload.points
    .filter((point) => typeof point?.date === "string" && Array.isArray(point?.prices))
    .map((point) => {
      const normalized = {
        date: point.date,
        prices: point.prices.map(toFiniteOrNull),
        provisional: point.provisional === true,
      };
      if (typeof point.asOf === "string" && point.asOf) {
        normalized.asOf = point.asOf;
      }
      return normalized;
    });
  return {
    ok: true,
    code: "ok",
    points,
    priceVersion: typeof payload.priceVersion === "string" ? payload.priceVersion : null,
    startDate: typeof payload.startDate === "string" ? payload.startDate : null,
    endDate: typeof payload.endDate === "string" ? payload.endDate : null,
    provisionalDate: typeof payload.provisionalDate === "string" ? payload.provisionalDate : null,
  };
}

/** `/sf-history/latest?itemId=` -> the current-price point (design §6). */
export function normalizeLatestPayload(payload, expectedItemId) {
  if (!payload || payload.itemId !== expectedItemId || !Array.isArray(payload.prices)) {
    return { ok: false, code: "invalidFormat", prices: null, latestUpdatedAt: null };
  }
  return {
    ok: true,
    code: "ok",
    prices: payload.prices.map(toFiniteOrNull),
    latestUpdatedAt: typeof payload.latestUpdatedAt === "string" ? payload.latestUpdatedAt : null,
  };
}

export function createSfHistorySource({
  baseUrl = import.meta.env.VITE_SF_HISTORY_API_BASE || DEFAULT_SF_HISTORY_API_BASE,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  return {
    async loadEquipment({ signal } = {}) {
      try {
        const response = await fetchImpl(`${baseUrl}/sf-history/equipment`, { signal });
        if (!response.ok) return { ok: false, code: "httpError", items: [] };
        return normalizeEquipmentPayload(await response.json());
      } catch (error) {
        return { ok: false, code: error?.name === "AbortError" ? "aborted" : "networkError", items: [] };
      }
    },

    async loadPrices(itemId, { signal } = {}) {
      try {
        const response = await fetchImpl(`${baseUrl}/sf-history/prices?itemId=${encodeURIComponent(itemId)}`, { signal });
        if (!response.ok) {
          return {
            ok: false,
            code: response.status === 404 ? "notFound" : "httpError",
            points: [],
            priceVersion: null,
            startDate: null,
            endDate: null,
          };
        }
        return normalizePricesPayload(await response.json(), itemId);
      } catch (error) {
        return {
          ok: false,
          code: error?.name === "AbortError" ? "aborted" : "networkError",
          points: [],
          priceVersion: null,
          startDate: null,
          endDate: null,
        };
      }
    },

    async loadLatest(itemId, { signal } = {}) {
      try {
        const response = await fetchImpl(`${baseUrl}/sf-history/latest?itemId=${encodeURIComponent(itemId)}`, { signal });
        if (!response.ok) {
          // design §6: an upstream failure (mapped to 503 by the server) or
          // an unknown item (404) must surface as "unavailable", never as a
          // reason to fall back to a historical value.
          return {
            ok: false,
            code: response.status === 503 ? "upstreamUnavailable" : response.status === 404 ? "notFound" : "httpError",
            prices: null,
            latestUpdatedAt: null,
          };
        }
        return normalizeLatestPayload(await response.json(), itemId);
      } catch (error) {
        return {
          ok: false,
          code: error?.name === "AbortError" ? "aborted" : "networkError",
          prices: null,
          latestUpdatedAt: null,
        };
      }
    },
  };
}

export const sfHistorySource = createSfHistorySource();
