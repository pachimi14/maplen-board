/**
 * IMPL_PLAN_SH42 §2 (B): resolves which item a page should open on, given
 * what the *previous* Enhance-History/New-Equipment page had selected
 * (`carried`) and this page's own freshly-loaded `items` list.
 *
 * Pure, React-free, unit-testable -- the actual holding of "what was
 * carried" lives in `../selectionStore.js` (a plain in-memory module-scope
 * singleton), kept separate so this resolution rule can be tested with
 * plain arrays/objects, the same split `../domain/series.js`'s own
 * `selectInitialItem` already uses for its own default-selection rule.
 *
 * Returns `null` -- never throws, never invents an id -- when there is
 * nothing to carry:
 *   - `carried` is `null`/malformed (e.g. `#/starforce` opened directly, or
 *     freshly reloaded -- nothing has been carried into this page load yet.
 *     Plan §2/(f): "#/starforce を直接開いたときの初期選択は従来どおり").
 *   - the carried item is not present in THIS page's own `items` (plan
 *     §2/(e): "New Equipment は監視対象の3件しか無いので... 保持した装備が
 *     そちらに無い場合は従来どおりの初期選択にフォールバック" -- SH-26's
 *     "穏当に劣化する" property).
 * Callers fall back to their own pre-existing default-selection logic in
 * either case (`selectInitialItem` for SfHistoryRoot, `items[0]` for
 * CubePricesRoot/DiscoveryRoot -- all unchanged by this plan).
 */
export function resolveCarriedSelection(items, carried) {
  if (!carried || !Number.isInteger(carried.itemId)) return null;
  const match = items.find((item) => item.itemId === carried.itemId);
  if (!match) return null;
  const alias =
    carried.alias && Number.isInteger(carried.alias.itemId) && typeof carried.alias.itemName === "string"
      ? carried.alias
      : { itemId: match.itemId, itemName: match.itemName };
  return { itemId: match.itemId, alias };
}

/**
 * IMPL_PLAN_SH46 §3 (B): a best-effort GUESS at which itemId to start
 * `/sf-history/prices` + `/sf-history/latest` for, in parallel with
 * `/sf-history/equipment` -- before the equipment list has loaded, so
 * `carried` cannot be validated against it yet (that is exactly what makes
 * this NOT `resolveCarriedSelection` above, which requires `items`).
 *
 * Never the final, authoritative selection: the caller's equipment-load
 * effect still computes the real `picked` item exactly as it did before
 * this plan (`resolveCarriedSelection(result.items, carried) ??
 * selectInitialItem(result.items)`) and always calls
 * `setSelectedItemId(picked.itemId)` unconditionally once equipment
 * arrives. If this guess turns out wrong -- a stale/absent carried
 * selection, or `defaultItemId` itself having dropped out of the list
 * (SH-26 §1(c)'s "穏当に劣化する" case) -- that later call corrects
 * `selectedItemId`, and the wrongly-prefetched price/latest data is
 * simply superseded by a fresh fetch for the correct id, the same way any
 * other `selectedItemId` change already was before this plan.
 */
export function guessPrefetchItemId(carried, defaultItemId) {
  return Number.isInteger(carried?.itemId) ? carried.itemId : defaultItemId;
}
