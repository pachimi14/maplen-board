/**
 * IMPL_PLAN_SH42 §2 (B): holds "what equipment is currently open", shared
 * across `#/starforce` / `#/starforce/cube-prices` / `#/starforce/discovery`
 * (the same three routes `SfHistoryTabs.jsx` switches between), so
 * switching tabs does not reset the user's search -- the plan's own quoted
 * user rationale: switching without this "同じ装備を検索し直す" ことになる.
 *
 * Same "plain in-memory module-scope singleton" shape `board/useHashRoute.js`'s
 * own route state already uses. Deliberately NOT React state: it must
 * survive one Root component unmounting and a different one mounting in
 * its place, which is exactly what happens on every one of these route
 * switches (App.jsx renders exactly one of SfHistoryRoot/CubePricesRoot/
 * DiscoveryRoot at a time, by route name -- there is no shared parent whose
 * React state would otherwise survive the switch). Deliberately NOT
 * localStorage/URL either (plan §2: "リロードをまたぐ必要は無い" /
 * "URL を変えない") -- a plain module-level variable already satisfies
 * both: it resets on a real page load/reload (satisfying (f): opening
 * `#/starforce` fresh still opens on SH-26's default), and it never touches
 * the URL.
 *
 * `resolveCarriedSelection` (./domain/selectionCarry.js) is the pure
 * function that decides what to DO with whatever this store holds; this
 * file only holds it.
 */
let carried = null; // { itemId, alias: { itemId, itemName } } | null

export function getCarriedSelection() {
  return carried;
}

export function setCarriedSelection(itemId, alias) {
  if (!Number.isInteger(itemId)) return;
  carried = {
    itemId,
    alias:
      alias && Number.isInteger(alias.itemId) && typeof alias.itemName === "string"
        ? alias
        : { itemId, itemName: String(itemId) },
  };
}
