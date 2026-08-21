// IMPL_PLAN_SH5 post-review fix (統括 P0, 2026-08-05): `SfHistoryRoot.jsx`
// crashed the whole app because a piece of async-derived state (`range`)
// reached `computeCurrentExpected`/`buildExpectedSeries` while it was
// still unconfirmed/malformed. `starforce.js`'s `validateStarRange` threw
// (correctly -- that file is not touched, per the review), and because
// the throw happened during render, React unmounted the whole tree.
//
// `buildScreenModel` is the single place that decides whether the confirmed
// async state (`range`, `pricesState`, `latestState`) is *actually* usable
// before calling into `expectedStarforceCostExact`/`requiredPriceStars`
// (via series.js). SfHistoryRoot.jsx calls this function -- it does not
// duplicate this gating logic inline -- so this file's tests are testing
// the exact code path production uses, without needing a DOM or
// @testing-library/react (design/plan: no new npm dependency).
import { buildExpectedSeries, computeCurrentExpected, computeStats, currentPercentile, sliceByPeriod } from "./series.js";
import { fillLeadingPriceGaps } from "./priceGapFill.js";
import { requiredPriceStars } from "../starforce.js";

/**
 * `range` is only "ready" to feed into a starforce.js-backed function once
 * it is a real `{ startStar, targetStar }` pair of integers. `range` starts
 * as `null` (useState(null)) and is later set from async results -- this
 * must reject `null`, `undefined`, and any wrong-shaped object (e.g. a
 * `{ from, to }` preset object passed by mistake, which is truthy and would
 * otherwise slip past a naive `if (!range)` check) just as reliably as it
 * accepts a well-formed range.
 */
export function isRangeReady(range) {
  return Boolean(range) && Number.isInteger(range.startStar) && Number.isInteger(range.targetStar);
}

/**
 * Builds everything SfHistoryRoot needs to render, from the same
 * async-derived state shapes the component holds (`range`, `period`,
 * `pricesState`, `latestState`). Never calls `buildExpectedSeries` /
 * `computeCurrentExpected` unless the state they depend on is both
 * *present* (status === "ready") and *well-formed* (`isRangeReady`) --
 * this is what makes the initial render (before the equipment fetch
 * resolves), an equipment switch mid-flight, a `latest` failure, and a
 * malformed `range` all safe to render instead of throwing.
 */
export function buildScreenModel({ range, period, pricesState, latestState }) {
  const rangeReady = isRangeReady(range);
  const pricesReady = pricesState?.status === "ready";

  // IMPL_PLAN_SH37 §3: `pricesState.points` is run through
  // `fillLeadingPriceGaps` (domain/priceGapFill.js) BEFORE
  // `buildExpectedSeries` sees it -- a band's leading null run only, never
  // a mid-series gap (see that module's own header). Byte-for-byte no-op
  // whenever no band has a leading gap (plan §7(e)).
  const { points: filledPoints, filledBands: allFilledBands } = pricesReady
    ? fillLeadingPriceGaps(pricesState.points)
    : { points: [], filledBands: [] };

  const fullSeries = rangeReady && pricesReady
    ? buildExpectedSeries(filledPoints, range.startStar, range.targetStar)
    : [];

  const periodSeries = sliceByPeriod(fullSeries, period);
  const stats = computeStats(periodSeries);

  const currentExpected = rangeReady && latestState?.status === "ready"
    ? computeCurrentExpected(latestState.prices, range.startStar, range.targetStar)
    : null;

  const percentile = currentPercentile(periodSeries, currentExpected);

  // IMPL_PLAN_SH37 §7(h): only the bands the CURRENTLY selected span
  // actually needs (`requiredPriceStars`, the exact set
  // `buildExpectedSeries`'s own missing-data gating uses) -- never every
  // band the item has ever had a leading gap in. This is what makes "no
  // filled interval in view -> no note" true per selected range, not just
  // per item (e.g. a 0->17 view never mentions a ☆19-only gap).
  const filledBands = rangeReady
    ? allFilledBands.filter((band) => requiredPriceStars(range.startStar, range.targetStar).includes(band.upgrade))
    : [];

  return { fullSeries, periodSeries, stats, currentExpected, percentile, filledBands };
}
