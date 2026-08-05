import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslation } from "../../i18n/I18nContext.jsx";
import { withDeltas } from "../domain/series.js";
import { formatAxisDate, formatCompactNeso, formatExactNeso, formatSignedCompactNeso, formatTooltipDate, localTimeZone } from "../domain/format.js";

// IMPL_PLAN_SH11 §2: axis ticks and the tooltip's time line are now the
// viewer's own local time (+ weekday) rather than fixed UTC -- `data` itself
// (the `date` ISO strings) is unchanged; only these two display call sites
// changed. `timeZone` is resolved once per module load (stable for the
// whole session, and equivalent -- in a browser -- to resolving it inside
// the component on every render).
const CHART_TIME_ZONE = localTimeZone();

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
function ChartTooltipContent({ active, payload, average, t, language }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point || point.expected == null) return null;
  const diffFromAverage = average != null ? point.expected - average : null;
  // IMPL_PLAN_SH8: a provisional point's `date` is only the bucket-start
  // draw position (still needed for the x-axis -- untouched), not when the
  // value was actually current. Showing `date` there is exactly the "looks
  // stale" bug this slice fixes (design §2-2/§0). Show `asOf` instead for a
  // provisional point; when it is absent, show no time line at all rather
  // than falling back to `date` (that fallback reintroduces the same bug).
  //
  // IMPL_PLAN_SH11 §2: both branches render in the viewer's local time (+
  // weekday) via `formatTooltipDate`'s `{ locale, timeZone }` -- the
  // provisional-vs-confirmed choice of *which* ISO string to show is
  // unchanged from SH8.
  const dateOptions = { locale: language, timeZone: CHART_TIME_ZONE };
  const timeLabel = point.provisional
    ? point.asOf
      ? formatTooltipDate(point.asOf, dateOptions)
      : null
    : formatTooltipDate(point.date, dateOptions);
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm shadow-lg">
      {timeLabel != null ? <div className="text-slate-400">{timeLabel}</div> : null}
      <div className="mt-0.5 font-bold text-cyan-300 tabular-nums">{formatExactNeso(point.expected)}</div>
      {point.delta != null ? (
        <div className={`mt-1 tabular-nums ${point.delta >= 0 ? "text-rose-400" : "text-emerald-400"}`}>
          {t("sfhistory.chart.tooltipDeltaFromPrev", { delta: formatSignedCompactNeso(point.delta) })}
        </div>
      ) : null}
      {diffFromAverage != null ? (
        <div className={`mt-1 tabular-nums ${diffFromAverage >= 0 ? "text-rose-400" : "text-emerald-400"}`}>
          {t("sfhistory.chart.tooltipDeltaFromAverage", { delta: formatSignedCompactNeso(diffFromAverage) })}
        </div>
      ) : null}
      {/* IMPL_PLAN_SH7 §4: "ツールチップに「暫定値(区間未終了)」" -- shown
          instead of (not in addition to) the confirmed-bucket note below,
          since a provisional point is by definition not a closed bucket. */}
      {point.provisional ? (
        <div className="mt-1.5 text-xs text-amber-400">{t("sfhistory.chart.tooltipProvisional")}</div>
      ) : (
        <div className="mt-1.5 text-xs text-slate-500">{t("sfhistory.chart.tooltipBucketNote")}</div>
      )}
    </div>
  );
}

// IMPL_PLAN_SH7 §4: only the *marker* for a provisional point is drawn (a
// hollow/open circle -- "中抜き"), never for anything else on the `bridge`
// series (its other end is the last confirmed point, already rendered,
// undotted, by the solid `confirmed` line below).
function ProvisionalDot({ cx, cy, payload }) {
  if (!payload?.provisional || cx == null || cy == null) return null;
  return <circle cx={cx} cy={cy} r={4} fill="none" stroke="#22d3ee" strokeWidth={2} />;
}

/**
 * IMPL_PLAN_SH7 §4: derives two additional per-row columns from `series`
 * (already tagged with `provisional` by domain/series.js's
 * buildExpectedSeries) so recharts can draw "only the last confirmed point
 * -> provisional point segment is dashed" with two <Line>s sharing the same
 * category axis, rather than one line that would otherwise render that
 * final segment in the same solid style as every other segment:
 *
 *   - `confirmed`: `expected`, but `null` at a provisional point -- this is
 *     what stops the solid line one point short of the provisional one.
 *   - `bridge`: `expected` at a provisional point AND at the confirmed point
 *     immediately before it (`null` everywhere else) -- these two adjacent,
 *     non-null values are exactly the one segment a second, dashed <Line>
 *     needs to draw the connector.
 *
 * A row's own `expected` field is left untouched (the tooltip and the
 * ReferenceLine/average comparison read `expected` directly, regardless of
 * which of the two lines rendered it).
 */
function withChartColumns(rows) {
  return rows.map((row, index) => {
    const isProvisional = row.provisional === true;
    const nextIsProvisional = rows[index + 1]?.provisional === true;
    return {
      ...row,
      confirmed: isProvisional ? null : row.expected,
      bridge: isProvisional || nextIsProvisional ? row.expected : null,
    };
  });
}

export default function SfHistoryChart({ series, average }) {
  const { t, language } = useTranslation();
  const data = withChartColumns(withDeltas(series));

  if (!data.length) {
    return <div className="flex h-64 items-center justify-center text-sm text-slate-500">{t("sfhistory.chart.empty")}</div>;
  }

  return (
    <div>
      <div className="h-64 md:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 16, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(value) => formatAxisDate(value, { locale: language, timeZone: CHART_TIME_ZONE })}
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
              stroke="#22d3ee"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#22d3ee", stroke: "#083344", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            {/* IMPL_PLAN_SH7 §4: dashed connector + hollow marker for the
                last-confirmed -> provisional segment only. */}
            <Line
              type="monotone"
              dataKey="bridge"
              stroke="#22d3ee"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={<ProvisionalDot />}
              activeDot={{ r: 5, fill: "transparent", stroke: "#22d3ee", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
              legendType="none"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-slate-500">{t("sfhistory.chart.gapNote")}</p>
      {data.some((row) => row.provisional) ? (
        <p className="mt-1 text-xs text-slate-500">{t("sfhistory.chart.provisionalLegend")}</p>
      ) : null}
    </div>
  );
}
