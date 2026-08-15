// IMPL_PLAN_SH32 §2 C: fetch wrapper for GET /sf-history/discovery/*. Same
// factory/normalizer shape as ../../integrations/sfHistorySource.js (design
// §5.1's "同型" precedent) -- a separate module rather than extending that
// file, so the existing #/starforce page's own fetch paths stay byte-for-
// -byte untouched (plan §4: "既存の #/starforce は1ピクセルも変えない").
//
// Same base URL / same "stay a CORS simple request" constraint as
// sfHistorySource.js (this is the same backend service, api.lulumi-tools.com
// -- server/sf-history/app.py's own preflight-405 note applies here too: no
// custom headers, GET only).
export const DEFAULT_DISCOVERY_API_BASE = "https://api.lulumi-tools.com";

function toFiniteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNonEmptyStringOrNull(value) {
  return typeof value === "string" && value ? value : null;
}

/** `/sf-history/discovery/equipment` -> the monitored-group list (plan
 * §5(g): one row per ACTIVE representative -- job-variant aliases are
 * already folded server-side, never a separate row per alias here). */
export function normalizeDiscoveryEquipmentPayload(payload) {
  if (!payload || !Array.isArray(payload.items)) {
    return { ok: false, code: "invalidFormat", items: [] };
  }
  const items = payload.items
    .filter((row) => Number.isInteger(row?.itemId))
    .map((row) => {
      const itemName = typeof row.itemName === "string" && row.itemName ? row.itemName : String(row.itemId);
      const aliases = Array.isArray(row.aliases) && row.aliases.length
        ? row.aliases
            .filter((alias) => Number.isInteger(alias?.itemId))
            .map((alias) => ({
              itemId: alias.itemId,
              itemName: typeof alias.itemName === "string" && alias.itemName ? alias.itemName : String(alias.itemId),
            }))
        : [{ itemId: row.itemId, itemName }];
      return {
        itemId: row.itemId,
        itemName,
        aliasItemIds: Array.isArray(row.aliasItemIds) && row.aliasItemIds.length
          ? row.aliasItemIds.filter((id) => Number.isInteger(id))
          : [row.itemId],
        aliases,
        stepsConsistent: row.stepsConsistent !== false,
        lastScanAt: toNonEmptyStringOrNull(row.lastScanAt),
        // IMPL_PLAN_SH33 follow-up (post-review, (m)): the server now keeps
        // a fully-settled group listed for SF_HISTORY_DISCOVERY_RECENT_DAYS
        // days past deactivation (so its own price table stays reachable)
        // -- `isActive` is how a caller tells that case apart from a still-
        // actively-monitored one. Defaults `true` for a payload that omits
        // it (should not happen against a real server, but never silently
        // mislabels a group "inactive" it has no evidence for).
        isActive: row.isActive !== false,
      };
    });
  return { ok: true, code: "ok", items };
}

/** `/sf-history/discovery/prices?itemId=` -> the ☆1-25 band list for one
 * monitored representative (plan §1/§5(h)/(j)). */
export function normalizeDiscoveryPricesPayload(payload, expectedItemId) {
  const empty = { itemName: null, upgradeCount: 0, observedAt: null, bands: [] };
  if (!payload || payload.itemId !== expectedItemId || !Array.isArray(payload.bands)) {
    return { ok: false, code: "invalidFormat", ...empty };
  }
  const bands = payload.bands
    .filter((band) => Number.isInteger(band?.itemUpgrade))
    .map((band) => ({
      itemUpgrade: band.itemUpgrade,
      price: toFiniteOrNull(band.price),
      step: toNonEmptyStringOrNull(band.step),
      priceAt: toNonEmptyStringOrNull(band.priceAt),
      isDiscovery: band.isDiscovery === true,
      // IMPL_PLAN_SH33 follow-up (post-review): this band's own observed
      // DISCOVERY -> CHANGE flip (discovery.find_transition's 5-minute-poll
      // window) -- null when never observed (still DISCOVERY, or already
      // CHANGE in the very first row ever recorded -- settled before
      // monitoring started). Same field names/shape as
      // normalizeDiscoveryRecentPayload's own windowStart/windowEnd below.
      windowStart: toNonEmptyStringOrNull(band.windowStart),
      windowEnd: toNonEmptyStringOrNull(band.windowEnd),
    }));
  return {
    ok: true,
    code: "ok",
    itemName: toNonEmptyStringOrNull(payload.itemName),
    upgradeCount: Number.isInteger(payload.upgradeCount) ? payload.upgradeCount : bands.length,
    observedAt: toNonEmptyStringOrNull(payload.observedAt),
    bands,
  };
}

/** `/sf-history/discovery/recent[?days=]` -> bands that recently flipped
 * DISCOVERY -> CHANGE (plan §5(k)). */
export function normalizeDiscoveryRecentPayload(payload) {
  if (!payload || !Array.isArray(payload.items)) {
    return { ok: false, code: "invalidFormat", days: null, items: [] };
  }
  const items = payload.items
    .filter((row) => Number.isInteger(row?.itemId) && Number.isInteger(row?.itemUpgrade))
    .map((row) => ({
      itemId: row.itemId,
      itemName: typeof row.itemName === "string" && row.itemName ? row.itemName : String(row.itemId),
      itemUpgrade: row.itemUpgrade,
      windowStart: toNonEmptyStringOrNull(row.windowStart),
      windowEnd: toNonEmptyStringOrNull(row.windowEnd),
    }));
  return { ok: true, code: "ok", days: Number.isInteger(payload.days) ? payload.days : null, items };
}

export function createDiscoverySource({
  baseUrl = import.meta.env.VITE_SF_HISTORY_API_BASE || DEFAULT_DISCOVERY_API_BASE,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  return {
    async loadEquipment({ signal } = {}) {
      try {
        const response = await fetchImpl(`${baseUrl}/sf-history/discovery/equipment`, { signal });
        if (!response.ok) return { ok: false, code: "httpError", items: [] };
        return normalizeDiscoveryEquipmentPayload(await response.json());
      } catch (error) {
        return { ok: false, code: error?.name === "AbortError" ? "aborted" : "networkError", items: [] };
      }
    },

    async loadPrices(itemId, { signal } = {}) {
      const empty = { itemName: null, upgradeCount: 0, observedAt: null, bands: [] };
      try {
        const response = await fetchImpl(`${baseUrl}/sf-history/discovery/prices?itemId=${encodeURIComponent(itemId)}`, { signal });
        if (!response.ok) {
          return { ok: false, code: response.status === 404 ? "notFound" : "httpError", ...empty };
        }
        return normalizeDiscoveryPricesPayload(await response.json(), itemId);
      } catch (error) {
        return { ok: false, code: error?.name === "AbortError" ? "aborted" : "networkError", ...empty };
      }
    },

    async loadRecent({ days, signal } = {}) {
      const query = Number.isInteger(days) && days > 0 ? `?days=${days}` : "";
      try {
        const response = await fetchImpl(`${baseUrl}/sf-history/discovery/recent${query}`, { signal });
        if (!response.ok) return { ok: false, code: "httpError", days: null, items: [] };
        return normalizeDiscoveryRecentPayload(await response.json());
      } catch (error) {
        return { ok: false, code: error?.name === "AbortError" ? "aborted" : "networkError", days: null, items: [] };
      }
    },
  };
}

export const discoverySource = createDiscoverySource();
