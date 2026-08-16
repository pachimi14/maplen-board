// IMPL_PLAN_SH32 §2 C: pure formatting/grouping for the DISCOVERY price
// table and the "recent" list. No React, no DOM, no i18n (matches this
// directory's existing domain/ convention -- format.js/series.js).

export const DISCOVERY_STEP = "STEP_TYPE_DISCOVERY";
export const CHANGE_STEP = "STEP_TYPE_CHANGE";

/** `itemUpgrade` (0-based, the API's own field -- plan §1 display range
 * 0..24) -> the ☆ number shown to a player (1-based, 1..25). */
export function starForUpgrade(itemUpgrade) {
  return itemUpgrade + 1;
}

/** `bands` (server's `/sf-history/discovery/prices` `bands[]`, any order) ->
 * a display-ready, ☆1..25-ordered row list. A band the server omitted
 * (should not normally happen -- the route always emits all 25) is filled
 * with a fully-null placeholder rather than shrinking the table, so the row
 * count is always `discovery.UPGRADE_COUNT` regardless of what came back.
 */
export function buildBandRows(bands, upgradeCount = 25) {
  const byUpgrade = new Map((bands ?? []).map((band) => [band.itemUpgrade, band]));
  const rows = [];
  for (let itemUpgrade = 0; itemUpgrade < upgradeCount; itemUpgrade++) {
    const band = byUpgrade.get(itemUpgrade);
    rows.push({
      itemUpgrade,
      star: starForUpgrade(itemUpgrade),
      price: band?.price ?? null,
      step: band?.step ?? null,
      priceAt: band?.priceAt ?? null,
      isDiscovery: band?.isDiscovery === true,
      // IMPL_PLAN_SH33 follow-up (post-review): this band's own observed
      // DISCOVERY -> CHANGE flip window -- null (never guessed) when this
      // band has not shown one yet (`discoverySource.js`'s own
      // normalizeDiscoveryPricesPayload already guarantees both are either
      // a non-empty string or null, never undefined).
      windowStart: band?.windowStart ?? null,
      windowEnd: band?.windowEnd ?? null,
    });
  }
  return rows;
}

/** IMPL_PLAN_SH34 §3/§4: the cube (potential) counterpart of
 * `buildBandRows` -- `cubes` (server's normalized `cubes[]`, already
 * data-driven -- NOT a fixed-length list like `bands`, plan §4: "キューブが
 * 1件も無い装備では、表ごと出さない") sorted by `cubeItemId` ascending
 * (defensive re-sort -- the server already sorts this way, plan §3: "序列を
 * 発明しない" applies here too, so this never re-orders by anything other
 * than the code itself). An empty input returns an empty row list -- the
 * caller (`DiscoveryCubeTable.jsx`) uses that to render nothing at all.
 */
export function buildCubeRows(cubes) {
  return [...(cubes ?? [])]
    .filter((cube) => Number.isInteger(cube?.cubeItemId))
    .sort((a, b) => a.cubeItemId - b.cubeItemId)
    .map((cube) => ({
      cubeItemId: cube.cubeItemId,
      cubeName: typeof cube.cubeName === "string" && cube.cubeName ? cube.cubeName : String(cube.cubeItemId),
      price: cube.price ?? null,
      step: cube.step ?? null,
      isDiscovery: cube.isDiscovery === true,
      windowStart: cube.windowStart ?? null,
      windowEnd: cube.windowEnd ?? null,
    }));
}

// plan §5(j): "ポーラーが止まった場合に黙って古い値を出し続ける...それを
// 利用者が見抜けるようにする". Component B's own cadence is 5 minutes
// (poll_discovery.py); 3x that (15 minutes) is a deliberately generous
// margin above ordinary poll jitter/timer RandomizedDelaySec before this
// calls the observation "stale" -- a false "stale" flag right after a
// normal, on-time poll would itself be a "無い異常を発明する" mistake.
export const STALE_OBSERVATION_MINUTES = 15;

/** Is `observedAt` (an ISO timestamp, or `null` if never polled) older than
 * `STALE_OBSERVATION_MINUTES`? `null` observedAt is never "stale" in this
 * function's sense -- it is its own, separately-handled "never polled yet"
 * state (the caller shows a different message for that, not a staleness
 * warning about a poll that never happened). `now` is injectable for tests. */
export function isObservationStale(observedAt, { now = new Date(), thresholdMinutes = STALE_OBSERVATION_MINUTES } = {}) {
  if (typeof observedAt !== "string" || !observedAt) return false;
  const observedMs = Date.parse(observedAt);
  if (Number.isNaN(observedMs)) return false;
  return now.getTime() - observedMs > thresholdMinutes * 60_000;
}

/** `recentItems` (server's `/sf-history/discovery/recent` `items[]`) grouped
 * by representative `itemId`, each with its own flipped-band list sorted by
 * `itemUpgrade` -- so the page can show "Item X: ☆4, ☆9 recently ended"
 * instead of one flat row per band. Groups are sorted by their most recent
 * `windowEnd` (descending -- newest transition first). */
export function groupRecentByItem(recentItems) {
  const byItemId = new Map();
  for (const row of recentItems ?? []) {
    const existing = byItemId.get(row.itemId);
    if (existing) {
      existing.bands.push(row);
    } else {
      byItemId.set(row.itemId, { itemId: row.itemId, itemName: row.itemName, bands: [row] });
    }
  }
  const groups = [...byItemId.values()].map((group) => ({
    ...group,
    bands: [...group.bands].sort((a, b) => a.itemUpgrade - b.itemUpgrade),
  }));
  groups.sort((a, b) => {
    const aLatest = Math.max(...a.bands.map((band) => Date.parse(band.windowEnd) || 0));
    const bLatest = Math.max(...b.bands.map((band) => Date.parse(band.windowEnd) || 0));
    return bLatest - aLatest;
  });
  return groups;
}
