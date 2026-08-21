// IMPL_PLAN_SH19 §1/§4 (2026-08-05 P0 fix, 統括 review): extracted from
// `components/SfHistoryChart.jsx` so the confirmed/bridge series-splitting
// logic is a plain, DOM-free function this file's own `chartColumns.test.js`
// can lock down directly -- `npm run test` staying green while the actual
// rendered SVG's dashed <Line> was empty (0 points) is exactly the class of
// bug a component-level assertion never catches (recharts' own path-`d`
// computation is not exercised by a plain data test), but the INPUT to that
// computation -- "does the `bridge` column have the 2 points it needs" --
// is, and is what actually broke: `integrations/sfHistorySource.js` was
// silently dropping the new `closed` field before it ever reached this
// function, so every point defaulted to "closed", `bridge` was empty at
// every index, and every point (including the still-open one) rendered on
// the solid line all the way to the chart's right edge.
import { bucketDisplayDate } from "./format.js";

/** A point is "open" (the one still-in-progress bucket) when the server
 * marked it `closed: false` -- see app.py's own header comment for the full
 * `closed`-vs-`provisional` rationale. `domain/series.js#buildExpectedSeries`
 * already defaults a missing `closed` to `true`, so this is a simple
 * strict-equality check, not another layer of defaulting. */
export function isOpenPoint(row) {
  return row?.closed === false;
}

/**
 * IMPL_PLAN_SH7 §4 (updated by SH19 §4 to key off `closed`, not
 * `provisional` -- see `isOpenPoint` above): derives two additional per-row
 * columns from `series` so recharts can draw "only the last closed point ->
 * still-open point segment is dashed" with two <Line>s sharing the same
 * category axis, rather than one line that would otherwise render that
 * final segment in the same solid style as every other segment:
 *
 *   - `confirmed`: `expected`, but `null` at the still-open point -- this is
 *     what stops the solid line one point short of the open one.
 *   - `bridge`: `expected` at the still-open point AND at the closed point
 *     immediately before it (`null` everywhere else) -- these two adjacent,
 *     non-null values are exactly the one segment a second, dashed <Line>
 *     needs to draw the connector. There is ALWAYS exactly 0 or 2 non-null
 *     `bridge` entries in a well-formed series (0 when there is no open
 *     point at all, 2 when there is one) -- never 1, and never more than 2
 *     (there is only ever one open point per plan §1's "∴ 破線は常に
 *     「進行中の足」1点だけ").
 *
 * A row's own `expected` field is left untouched (the tooltip and the
 * ReferenceLine/average comparison read `expected` directly, regardless of
 * which of the two lines rendered it).
 *
 * IMPL_PLAN_SH18 §3: also adds `displayDate` -- `bucketDisplayDate(row)`,
 * the axis's own dataKey. Row order (and therefore each point's x position)
 * is unaffected: this only changes which instant is *shown* at each
 * already-ordered position, never the ordering itself.
 */
export function withChartColumns(rows) {
  return rows.map((row, index) => {
    const isOpen = isOpenPoint(row);
    const nextIsOpen = isOpenPoint(rows[index + 1]);
    return {
      ...row,
      confirmed: isOpen ? null : row.expected,
      bridge: isOpen || nextIsOpen ? row.expected : null,
      displayDate: bucketDisplayDate(row),
    };
  });
}

/**
 * IMPL_PLAN_SH38 §1: the x-range (in terms of `withChartColumns`'s own
 * `displayDate` column) to shade with the "this span includes a point
 * `domain/priceGapFill.js#fillLeadingPriceGaps` filled" background band --
 * a THIRD, separate channel from the dashed "still-open bucket" line above
 * (plan §0: "同じ線種に2つ目の意味を載せない" -- this never touches
 * `isOpenPoint`/`withChartColumns`'s own confirmed/bridge split).
 *
 * `filledBands` is `domain/viewModel.js#buildScreenModel`'s own
 * `[{ upgrade, untilDate }]` (already scoped to the star levels the
 * currently selected range needs) -- this function only READS it, never
 * recomputes what was filled (`priceGapFill.js`'s own fill logic is
 * untouched by this plan).
 *
 * Every entry's fill always starts from the very FIRST point of the full
 * (unsliced) series -- `fillLeadingPriceGaps` only ever fills a band's
 * LEADING null run, anchored at index 0, never a mid-series gap. That is
 * exactly why the union across every filled band is never fragmented: it
 * is always precisely "every point strictly before `max(untilDate)`" --
 * true by construction (each band's own filled run is `[0, firstRealIndex)`,
 * so the union of any set of such runs is `[0, max(firstRealIndex))`),
 * never something this function has to search for or that could land on a
 * different result for a different item (plan §4-2's stop condition).
 *
 * `rows` is `withChartColumns`'s own chronologically-ascending output (or
 * anything sharing its `{ date, displayDate }` shape) -- membership is
 * decided from `row.date` (the same bucket-start `priceGapFill.js`'s
 * `untilDate` values are keyed off), never `displayDate` (which may be
 * shifted +4h per `bucketDisplayDate`'s own rule) -- `displayDate` is only
 * read for the RETURNED `x1`/`x2`, because `ReferenceArea` needs an actual
 * value present in the x-axis's own category domain (the same dataKey the
 * `<XAxis>` uses), not an arbitrary date string.
 *
 * Returns `null` when there is nothing to shade: no filled band in view, or
 * the fill entirely precedes the currently displayed period slice (every
 * point onscreen is already real, plan (c): "埋めが無ければ帯を出さない").
 */
export function filledBandRange(rows, filledBands) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (!Array.isArray(filledBands) || filledBands.length === 0) return null;

  const untilTimes = filledBands
    .map((band) => (typeof band?.untilDate === "string" ? Date.parse(band.untilDate) : NaN))
    .filter((time) => Number.isFinite(time));
  if (!untilTimes.length) return null;
  const bandEnd = Math.max(...untilTimes);

  let lastFilledIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    const time = Date.parse(rows[i]?.date);
    if (!Number.isFinite(time)) continue;
    if (time < bandEnd) {
      lastFilledIndex = i;
      continue;
    }
    break; // rows are chronologically ascending -- every later row is >= bandEnd too
  }
  if (lastFilledIndex === -1) return null;

  return { x1: rows[0].displayDate, x2: rows[lastFilledIndex].displayDate };
}
