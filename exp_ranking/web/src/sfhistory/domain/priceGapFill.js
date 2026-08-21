// IMPL_PLAN_SH37 §2/§3 (user decision, 2026-08-21): a band's *leading* null
// run -- the stretch of points strictly BEFORE that band's own first real
// (non-null) price anywhere in `points` -- is filled with a fixed lower-
// bound price, never a real one. This is deliberately narrower than "fill
// every null": a null AFTER a band's first real point is a mid-series gap
// (a data-collection hole), a different thing entirely from "price was
// still forming" -- plan §3: "履歴が始まったあとの中抜けは埋めない" -- and is
// left `null`, unchanged, so the chart still breaks there rather than
// hiding a real gap.
//
// `LOWER_BOUND_PRICE` (1e-6 NESO) is a REAL price, not an invented one --
// literally the price upstream itself assigns to a not-yet-priced band at
// the very start of that band's price-formation window (the "bonus time"
// starting price dynamic pricing gives the first buyers of a band -- SH-34's
// own findings, see discovery/domain/priceFormat.js's header: "0.000001 か
// ら始まり上下しながら育つ"). The price then climbs as the band forms -- a
// real rise, never a fake-to-real transition (measured on Hat: ☆1 grew to
// 133.59 NESO, ☆10 to 1,335.87 NESO by the time real per-4h-bucket data
// begins). An earlier version of this comment (and the SH-38 legend text it
// once backed) mischaracterized this value as fake/not-a-real-price -- do
// not reintroduce that framing.
//
// Because this fill uses that one known STARTING real price for every null
// in a band's leading run, a later null within that same still-untracked
// window may in fact have already climbed above 1e-6 by the time it
// happened -- this is exactly why the constant is named a LOWER bound: at
// or below the true value at every point, never above it. Plan §2-2: that
// gap is at most a few thousand NESO against a formed band's low-millions
// -- well under 0.05% of a typical multi-band Expected total (see the
// plan's own worked Hat 0->22 table, and the completion report's
// production-data verification).
//
// This never touches an already non-null price -- whether a real
// historical value, or a value `/sf-history/prices`' own server-side
// `forming_prices` fill (IMPL_PLAN_SH36 §3, app.py) already wrote in -- so
// this is a strict byte-for-byte no-op for any item/band whose `points`
// array already has a real value at index 0 (every pre-SH-36 item, plan
// §7(e)). In practice SH-36's fill and this fill operate on disjoint null
// slots: a still-forming band already has no nulls left by the time this
// runs (SH-36 already wrote its current price into every one of that
// band's slots, historical and provisional alike), so this function only
// ever finds leading nulls to fill on a band that has since FINISHED
// forming -- exactly the case SH-36's own fill no longer reaches (plan
// §3's "SH-36 の性質... 両方が同時に効くこと").
export const LOWER_BOUND_PRICE = 0.000001;

/**
 * `points`: chronologically-ascending array of `{ date, prices: (number|
 * null)[], ... }` (the same shape `/sf-history/prices`' `points` field and
 * `domain/series.js#buildExpectedSeries` already use -- this runs BEFORE
 * that function, never duplicating its missing-data gating).
 *
 * Returns `{ points, filledBands }`:
 *  - `points`: same array (by reference) if nothing was filled -- never a
 *    needless clone (plan §7(e)'s bit-for-bit requirement is trivially
 *    true when there is nothing to change); otherwise a new array where
 *    only the touched points/prices are new objects/arrays (every
 *    untouched point keeps its original reference).
 *  - `filledBands`: `[{ upgrade, untilDate }]`, one entry per star band
 *    (`upgrade` = the raw 0-based `prices[]` index -- the same index
 *    `discovery.py`'s own `itemUpgrade` uses server-side, i.e. `☆(upgrade
 *    + 1)`) that had at least one point filled, sorted by `upgrade`.
 *    `untilDate` is that band's own first REAL point's `date` -- the plan
 *    §7(g) "いつまで形成中だったか" boundary. `[]` when nothing was filled.
 */
export function fillLeadingPriceGaps(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return { points: Array.isArray(points) ? points : [], filledBands: [] };
  }

  const upgradeCount = points.reduce(
    (max, point) => Math.max(max, Array.isArray(point?.prices) ? point.prices.length : 0),
    0,
  );
  if (upgradeCount === 0) return { points, filledBands: [] };

  // Pass 1 (read-only): each band's own first real-price index, over the
  // UNMODIFIED `points` -- never influenced by anything Pass 2 fills in.
  const firstRealIndex = new Array(upgradeCount).fill(-1);
  points.forEach((point, index) => {
    const prices = point?.prices;
    if (!Array.isArray(prices)) return;
    for (let upgrade = 0; upgrade < upgradeCount; upgrade++) {
      if (firstRealIndex[upgrade] === -1 && prices[upgrade] != null) firstRealIndex[upgrade] = index;
    }
  });

  // Pass 2: fill only a null strictly before that band's own
  // firstRealIndex. A band with firstRealIndex === -1 (never real anywhere
  // in `points`) is left entirely untouched -- there is no anchor to fill
  // toward ("無い数字を発明しない").
  let anyFilled = false;
  const filledUpgrades = new Set();
  const filledPoints = points.map((point, index) => {
    const prices = point?.prices;
    if (!Array.isArray(prices)) return point;
    let touchedThisPoint = null;
    const nextPrices = prices.map((price, upgrade) => {
      const anchor = firstRealIndex[upgrade];
      if (price == null && anchor !== -1 && index < anchor) {
        anyFilled = true;
        filledUpgrades.add(upgrade);
        (touchedThisPoint ??= []).push(upgrade);
        return LOWER_BOUND_PRICE;
      }
      return price;
    });
    if (!touchedThisPoint) return point;
    // plan §3: "埋めた帯・埋めた区間を、点ごとに識別できる形で持つ" -- kept on
    // the point itself (in addition to the aggregate `filledBands` below)
    // in case a future per-point display needs it without re-deriving.
    return { ...point, prices: nextPrices, filledUpgrades: touchedThisPoint };
  });

  const filledBands = [...filledUpgrades]
    .sort((a, b) => a - b)
    .map((upgrade) => ({ upgrade, untilDate: points[firstRealIndex[upgrade]].date }));

  return { points: anyFilled ? filledPoints : points, filledBands };
}
