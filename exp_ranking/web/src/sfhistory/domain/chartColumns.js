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
