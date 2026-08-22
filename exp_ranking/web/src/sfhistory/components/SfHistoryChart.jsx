import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslation } from "../../i18n/I18nContext.jsx";
import { withDeltas } from "../domain/series.js";
import { filledBandRange, isOpenPoint, withChartColumns } from "../domain/chartColumns.js";
import {
  bucketDisplayDate,
  formatAxisDate,
  formatBucketRange,
  formatCompactNeso,
  formatExactNeso,
  formatSignedCompactNeso,
  formatTooltipDate,
  formatTooltipDateLocal,
} from "../domain/format.js";

// IMPL_PLAN_SH14 §2 (2026-08-05, user decision): reverts IMPL_PLAN_SH11 §2's
// viewer-local-time axis ticks / tooltip time line back to a fixed UTC --
// `data` itself (the `date` ISO strings) is unchanged, only unaffected by
// the choice of display zone as it always was. `formatAxisDate`/
// `formatTooltipDate` (domain/format.js) still take no `timeZone` option --
// the X axis below stays UTC-only by this plan's own choice (IMPL_PLAN_SH29
// §1: "軸ラベルは場所が狭いので UTC のみでよい" -- the axis has materially
// less width than a tooltip, and `minTickGap={24}` already thins ticks
// aggressively; a second stacked line per tick would either overlap or
// force ticks sparser than the single-line UTC axis already needs. This
// implementer's judgment call, made explicit here as the plan's §1 asked
// for regardless of which way it landed).
//
// IMPL_PLAN_SH29 §1 (2026-08-06, user decision): the tooltip now shows a
// *second* line under the UTC one -- the viewer's own local time, via the
// new `formatTooltipDateLocal` (domain/format.js), which is additive to
// `formatTooltipDate`/`bucketDisplayDate` here, not a replacement of either.
// UTC stays primary/authoritative (SH-14's decision, unchanged); local is
// always the smaller, secondary line, always zone-labeled (never shown
// unlabeled) -- see `ChartTooltipContent` below.
//
// IMPL_PLAN_SH18 §1/§3 (2026-08-05, user decision, reverses design §8's
// "ラベルは区間開始"): a row's own `date` (bucket start, still what
// `formatBucketRange`'s range note reads -- SH-17's range note is
// unchanged, plan (c)) is no longer what gets shown as *the* time -- see
// `bucketDisplayDate` (domain/format.js) for the "+4h, except the still-
// open bucket keeps `asOf`" rule this file now applies at both the axis
// (`withChartColumns`'s new `displayDate` column) and the tooltip
// (`ChartTooltipContent`'s `timeLabel`) below.

// IMPL_PLAN_SH5 §2: recharts LineChart, Expected only (design §12: no
// p50/p70/p90). ReferenceLine = period average; high/low are read off the
// summary cards rather than duplicated as extra chart lines (design's own
// "装飾控えめ" -- avoids clutter on a series that can already have gaps).
//
// IMPL_PLAN_SH9 §4 scope note: the line/dot/axis colors below stay a fixed
// cyan (#22d3ee) regardless of the 4-color theme picker -- a deliberate,
// documented choice (data-series color locked for readability/consistency
// across theme switches, same rationale many finance dashboards use), not
// an oversight. Only the surrounding chrome (backgrounds, borders, tabs,
// summary text -- sfhistory.css) responds to the picker.
//
// IMPL_PLAN_SH38 §1-2: the `<ReferenceArea className="sfh-filled-band">`
// band below (color: `--sfh-color-filled-band`, sfhistory.css) follows this
// same "fixed, not theme-color-branched" rule, for the same reason -- see
// that CSS variable's own comment.
function ChartTooltipContent({ active, payload, average, t, language }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point || point.expected == null) return null;
  const diffFromAverage = average != null ? point.expected - average : null;
  // IMPL_PLAN_SH17 §4-1 (revises IMPL_PLAN_SH16's own §1/§4 fix, per the
  // 2026-08-05 user decision): `point.asOf` is only ever present on the
  // still-open ("未終了") bucket's point (server-side: app.py only attaches
  // it there). When present, it is the *time* to show -- the current
  // instant the value is as-of, even though the point's *position* stays at
  // the bucket's own start (`point.date`, unchanged). Either way there is
  // always a real time to show -- SH-16's "time missing entirely" fix is
  // preserved.
  //
  // IMPL_PLAN_SH14 §2: still rendered in UTC (+ weekday) via
  // `formatTooltipDate`'s `{ locale }`, unchanged from SH8/SH14.
  //
  // IMPL_PLAN_SH18 §3 (2026-08-05, user decision, reverses design §8):
  // every other point kind (confirmed, elapsed-but-unaggregated) no
  // longer shows `point.date` (its own bucket *start*) here -- it shows
  // the bucket's *end* instead, via `bucketDisplayDate(point)` (same
  // `asOf` result as SH-17 for a still-open point; see that function's own
  // doc comment for the full three-way rule and its future-time guard).
  const dateOptions = { locale: language };
  const timeLabel = formatTooltipDate(bucketDisplayDate(point), dateOptions);
  // IMPL_PLAN_SH29 §1: same instant as `timeLabel` above, read on the
  // viewer's own local clock instead -- rendered directly under it (smaller,
  // dimmer) so UTC stays the primary/authoritative reading (SH-14) while
  // the local time is always available right next to it, always explicitly
  // zone-labeled (`formatTooltipDateLocal` -> `formatTimeZoneLabel`, never
  // an unlabeled local time).
  const localTimeLabel = formatTooltipDateLocal(bucketDisplayDate(point), dateOptions);
  // IMPL_PLAN_SH17 §4-2: replaces SH-7's static `tooltipBucketNote`/
  // `tooltipProvisional` pair with the bucket's own `HH:MM–HH:MM` range,
  // always derived from `point.date` (the bucket-start position, never
  // `asOf`) -- this is what explains *why* the point sits where it does.
  // `point.asOf` presence is the sole "is this still open" signal (only the
  // unified in-progress point ever carries it, per app.py); a completed-
  // but-unaggregated bucket (also `provisional`, but no `asOf`) gets the
  // same plain range as a confirmed bucket -- it already fully elapsed, it
  // just hasn't been persisted to the 4h table yet.
  const bucketRange = formatBucketRange(point.date);
  const isOpenBucket = point.asOf != null;
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm shadow-lg">
      {timeLabel != null ? (
        <div className="text-slate-400">
          <div>{timeLabel}</div>
          {/* IMPL_PLAN_SH29 §1: the secondary local-time line -- UTC above
              stays primary. */}
          {localTimeLabel ? <div className="text-[11px] text-slate-500">{localTimeLabel}</div> : null}
        </div>
      ) : null}
      <div className="mt-0.5 font-bold text-cyan-300 tabular-nums">{formatExactNeso(point.expected)}</div>
      {/* IMPL_PLAN_SH12 §2: `.sfh-delta-up`/`.sfh-delta-down` (sfhistory.css)
          instead of Tailwind's `text-rose-400`/`text-emerald-400` -- the
          latter silently failed to resolve inside `.sfh-root` and fell
          through to `--theme-focus`, making a price *increase* render in
          the same color as the Expected value on every non-green theme. */}
      {point.delta != null ? (
        <div className={`mt-1 tabular-nums ${point.delta >= 0 ? "sfh-delta-up" : "sfh-delta-down"}`}>
          {t("sfhistory.chart.tooltipDeltaFromPrev", { delta: formatSignedCompactNeso(point.delta) })}
        </div>
      ) : null}
      {diffFromAverage != null ? (
        <div className={`mt-1 tabular-nums ${diffFromAverage >= 0 ? "sfh-delta-up" : "sfh-delta-down"}`}>
          {t("sfhistory.chart.tooltipDeltaFromAverage", { delta: formatSignedCompactNeso(diffFromAverage) })}
        </div>
      ) : null}
      {bucketRange != null ? (
        <div className={`mt-1.5 text-xs ${isOpenBucket ? "text-amber-400" : "text-slate-500"}`}>
          {t(isOpenBucket ? "sfhistory.chart.tooltipBucketRangeOpen" : "sfhistory.chart.tooltipBucketRange", {
            start: bucketRange.start,
            end: bucketRange.end,
          })}
        </div>
      ) : null}
    </div>
  );
}

// IMPL_PLAN_SH19 §1/§4 (2026-08-05 P0 fix): `isOpenPoint`/`withChartColumns`
// moved to `domain/chartColumns.js` (pure, DOM-free -- see that file's own
// header comment for the full `closed`-vs-`provisional` rationale and why
// this needed to be independently unit-testable). Only the JSX-dependent
// `ProvisionalDot` marker stays here.
//
// IMPL_PLAN_SH7 §4 (updated by SH19 §4 to key off `closed`, see
// `domain/chartColumns.js#isOpenPoint`): only the *marker* for the
// still-open point is drawn (a hollow/open circle -- "中抜き"), never for
// anything else on the `bridge` series (its other end is the last confirmed
// point, already rendered, undotted, by the solid `confirmed` line below).
//
// IMPL_PLAN_SH44 §2-2 (g): `color` is now a prop (default "#22d3ee", the
// exact literal this component always used before this plan) so the same
// marker can be reused for an overlaid cube line's own dashed segment,
// still keyed off the same `closed`-based `isOpenPoint` -- "4本それぞれで
// 未終了足が破線になる" falls out of this for free, since every cube type's
// series is built from the very same points (`domain/cubeSeries.js#
// buildCubeSeries`) and therefore carries the same `closed` flag at the
// same index (see that function's own header).
function ProvisionalDot({ cx, cy, payload, color = "#22d3ee" }) {
  if (!isOpenPoint(payload) || cx == null || cy == null) return null;
  return <circle cx={cx} cy={cy} r={4} fill="none" stroke={color} strokeWidth={2} />;
}

/**
 * IMPL_PLAN_SH44 §2-2: merges N additional, already `withChartColumns`-
 * processed row arrays into `mainRows`' own row objects, keyed by the
 * shared `date` field -- each additional array's own `confirmed`/`bridge`
 * columns land under `confirmed_${key}`/`bridge_${key}` on the matching
 * `mainRows` row, so a single recharts `data` array can drive one <Line>
 * pair per series while `mainRows`' own fields (what the 2 pre-existing
 * <Line>s and `ChartTooltipContent` already read: `expected`/`delta`/
 * `confirmed`/`bridge`/`displayDate`/...) are completely untouched.
 *
 * Never re-runs `isOpenPoint`/`withChartColumns` itself (`domain/
 * chartColumns.js`'s own computation is unchanged by this plan, per plan
 * §5) -- callers already ran that SAME, unmodified function once per
 * series; this only zips the already-computed *results* together.
 *
 * `extraRowsList` entries whose `date` has no match in `mainRows` are
 * skipped, not thrown on -- defensive only: every one of this plan's own
 * callers derives every series (main and extra) from the very same
 * `/sf-history/cube-prices` `points` array via `buildCubeSeries`
 * (`domain/cubeSeries.js`), so the `date` sequence is identical across all
 * of them in practice.
 *
 * `extraRowsList.length === 0` returns `mainRows` itself, unchanged (not a
 * copy) -- this is what keeps `SfHistoryChart`'s existing call sites (no
 * `extraSeries` prop passed at all) on the exact same `data` array shape
 * this component has always produced (plan (j)).
 */
export function mergeExtraSeriesColumns(mainRows, extraRowsList) {
  if (!extraRowsList.length) return mainRows;
  const byDate = new Map(mainRows.map((row) => [row.date, { ...row }]));
  for (const { key, rows } of extraRowsList) {
    for (const row of rows) {
      const target = byDate.get(row.date);
      if (!target) continue;
      target[`confirmed_${key}`] = row.confirmed;
      target[`bridge_${key}`] = row.bridge;
    }
  }
  return Array.from(byDate.values());
}

// IMPL_PLAN_SH38 §0/§1: a band's leading-gap fill (SH-37,
// `priceGapFill.js`, read via `filledBands` -- see `domain/chartColumns.js#
// filledBandRange`'s own header for why the union is always one contiguous
// range) gets a THIRD, separate channel -- a background `<ReferenceArea>`,
// deliberately NOT the dashed line (§0: "同じ線種に2つ目の意味を載せない";
// the dashed line stays exactly what SH-19 fixed it to mean: the one
// still-open, not-yet-ended 4-hour bucket). The two can and do appear
// together on the same chart (e.g. Hat 0->22: the filled band ends 8/20,
// the dashed segment is the chart's own last point) -- they read as
// distinct because they are on different visual channels (fill vs. stroke)
// entirely, not different styles of the same channel.
// IMPL_PLAN_SH44 §2-2: `mainColor`/`mainStrokeWidth`/`extraSeries` are new,
// all with the exact defaults this component's 2 <Line>s have always
// hardcoded ("#22d3ee" / 2 / no extra lines at all) -- every existing call
// site (SfHistoryRoot.jsx's own SF History chart, and this component's own
// pre-SH44 tests) omits all 3, so its rendered output is byte-for-byte
// unchanged (plan (j): "単系列で呼んだときの SF History の描画が1ピクセルも
// 変わらない"). `extraSeries` is `[{ key, series, color, strokeWidth }]` --
// each entry gets its own confirmed/dashed <Line> pair, merged onto the
// same `data` array via `mergeExtraSeriesColumns` above so every line
// shares one x-axis; this component itself does not know or care that its
// only caller for a non-empty `extraSeries` is the cube-prices page
// (`CubePricesRoot.jsx`) comparing multiple cube sub-types -- it is a
// generic "overlay more lines on the same chart" capability, not
// cube-specific.
export default function SfHistoryChart({ series, average, filledBands, mainColor = "#22d3ee", mainStrokeWidth = 2, extraSeries = [] }) {
  const { t, language } = useTranslation();
  const mainData = withChartColumns(withDeltas(series));
  const extraRowsList = extraSeries.map(({ key, series: extraSeriesRows, color, strokeWidth }) => ({
    key,
    color,
    strokeWidth: strokeWidth ?? 1.5,
    rows: withChartColumns(withDeltas(extraSeriesRows)),
  }));
  const data = mergeExtraSeriesColumns(mainData, extraRowsList);

  if (!data.length) {
    return <div className="flex h-64 items-center justify-center text-sm text-slate-500">{t("sfhistory.chart.empty")}</div>;
  }

  // `null` whenever there is nothing to shade in the currently visible
  // period slice (no filled band in view at all, or the fill entirely
  // precedes it) -- `filledBandRange`'s own header has the full contiguity
  // rationale. Drives both the `<ReferenceArea>` below and the paired
  // legend line (plan (g): "帯が無いときは網掛けの凡例を出さない").
  const bandRange = filledBandRange(data, filledBands);

  return (
    <div>
      <div className="h-64 md:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 16, left: 8, bottom: 4 }}>
            {/* Rendered FIRST (before the grid/axes/lines below) so every
                other layer -- grid, average reference line, the data lines
                and their dots, the tooltip cursor -- draws on TOP of the
                band, never the other way around (plan (d): "帯が線とデータ
                点を隠していない"). No `y1`/`y2` -- omitting both makes
                `ReferenceArea` span the axis's full vertical range, i.e. a
                full-height vertical band, exactly like `ReferenceLine`
                above already does for `average` on the y-axis. */}
            {bandRange ? (
              <ReferenceArea
                className="sfh-filled-band"
                x1={bandRange.x1}
                x2={bandRange.x2}
                stroke="none"
                fillOpacity={1}
                isFront={false}
              />
            ) : null}
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            {/* IMPL_PLAN_SH18 §3: `displayDate` (withChartColumns), not the
                raw `date` (bucket start) -- see that function's doc comment. */}
            <XAxis
              dataKey="displayDate"
              tickFormatter={(value) => formatAxisDate(value, { locale: language })}
              tick={{ fill: "#94a3b8", fontSize: 11 }}
              minTickGap={24}
              axisLine={{ stroke: "#334155" }}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={formatCompactNeso}
              tick={{ fill: "#94a3b8", fontSize: 11 }}
              width={56}
              axisLine={{ stroke: "#334155" }}
            />
            {average != null ? (
              <ReferenceLine y={average} stroke="#fbbf24" strokeDasharray="4 4" strokeOpacity={0.7} />
            ) : null}
            <Tooltip content={<ChartTooltipContent average={average} t={t} language={language} />} />
            <Line
              type="monotone"
              dataKey="confirmed"
              stroke={mainColor}
              strokeWidth={mainStrokeWidth}
              dot={false}
              activeDot={{ r: 4, fill: mainColor, stroke: "#083344", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            {/* IMPL_PLAN_SH7 §4 (updated by SH19 §4): dashed connector +
                hollow marker for the last-closed -> still-open segment
                only. */}
            <Line
              type="monotone"
              dataKey="bridge"
              stroke={mainColor}
              strokeWidth={mainStrokeWidth}
              strokeDasharray="5 4"
              dot={<ProvisionalDot color={mainColor} />}
              activeDot={{ r: 5, fill: "transparent", stroke: mainColor, strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
              legendType="none"
            />
            {/* IMPL_PLAN_SH44 §2-2 (b)(c)(g): one confirmed/dashed <Line>
                pair per additional cube type, always thinner than the main
                pair above (plan (c): caller passes `strokeWidth` < `mainStrokeWidth`,
                this component does not itself enforce the inequality --
                CubePricesRoot.jsx's own header documents the exact values
                used). `legendType="none"` on both, same as the main bridge
                line above -- this component still renders no built-in
                recharts <Legend/>; the cube-vs-color legend is a separate,
                cube-specific component (`CubeLegend.jsx`) rendered by the
                caller, not this shared one (plan (j): keeps this file's own
                JSX output, for a call with no `extraSeries`, identical to
                before this plan). */}
            {extraRowsList.map(({ key, color, strokeWidth }) => (
              <Line
                key={`confirmed_${key}`}
                type="monotone"
                dataKey={`confirmed_${key}`}
                stroke={color}
                strokeWidth={strokeWidth}
                dot={false}
                activeDot={{ r: 3, fill: color, stroke: "#083344", strokeWidth: 1.5 }}
                connectNulls={false}
                isAnimationActive={false}
                legendType="none"
              />
            ))}
            {extraRowsList.map(({ key, color, strokeWidth }) => (
              <Line
                key={`bridge_${key}`}
                type="monotone"
                dataKey={`bridge_${key}`}
                stroke={color}
                strokeWidth={strokeWidth}
                strokeDasharray="5 4"
                dot={<ProvisionalDot color={color} />}
                activeDot={{ r: 4, fill: "transparent", stroke: color, strokeWidth: 1.5 }}
                connectNulls={false}
                isAnimationActive={false}
                legendType="none"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* IMPL_PLAN_SH38 §1-3: paired with the dashed-line legend below --
          "網掛け＝価格形成中の帯を含む区間 / 破線＝まだ終了していない4時間
          足". Gated on `bandRange` (not merely `filledBands.length`) so a
          filled band that finished entirely BEFORE the currently visible
          period slice never shows a legend line for a band that is not
          actually drawn (plan (g)). This is a SEPARATE line from
          `provisionalLegend` below -- the existing dashed-line legend text
          is unchanged by this plan (plan (f)). */}
      {bandRange ? <p className="mt-1 text-xs text-slate-500">{t("sfhistory.chart.filledBandLegend")}</p> : null}
      {/* IMPL_PLAN_SH19 §1/§4: gated on `closed === false` (isOpenPoint), not
          `provisional` -- the legend text itself ("...current, still-open
          4-hour bucket") only describes the one still-open point, not an
          elapsed-but-unaggregated one. */}
      {data.some((row) => isOpenPoint(row)) ? (
        <p className="mt-1 text-xs text-slate-500">{t("sfhistory.chart.provisionalLegend")}</p>
      ) : null}
    </div>
  );
}
