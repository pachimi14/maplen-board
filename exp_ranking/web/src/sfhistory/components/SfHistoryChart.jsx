import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslation } from "../../i18n/I18nContext.jsx";
import { withDeltas } from "../domain/series.js";
import { formatAxisDate, formatCompactNeso, formatExactNeso, formatSignedCompactNeso, formatTooltipDate } from "../domain/format.js";

// IMPL_PLAN_SH5 §2: recharts LineChart, Expected only (design §12: no
// p50/p70/p90). ReferenceLine = period average; high/low are read off the
// summary cards rather than duplicated as extra chart lines (design's own
// "装飾控えめ" -- avoids clutter on a series that can already have gaps).
function ChartTooltipContent({ active, payload, average, t }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point || point.expected == null) return null;
  const diffFromAverage = average != null ? point.expected - average : null;
  return (
    <div className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm shadow-lg">
      <div className="text-slate-400">{formatTooltipDate(point.date)}</div>
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
      <div className="mt-1.5 text-xs text-slate-500">{t("sfhistory.chart.tooltipBucketNote")}</div>
    </div>
  );
}

export default function SfHistoryChart({ series, average }) {
  const { t } = useTranslation();
  const data = withDeltas(series);

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
              tickFormatter={formatAxisDate}
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
            <Tooltip content={<ChartTooltipContent average={average} t={t} />} />
            <Line
              type="monotone"
              dataKey="expected"
              stroke="#22d3ee"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#22d3ee", stroke: "#083344", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-slate-500">{t("sfhistory.chart.gapNote")}</p>
    </div>
  );
}
