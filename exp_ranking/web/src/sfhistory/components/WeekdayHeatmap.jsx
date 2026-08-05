import { Fragment, useMemo } from "react";
import { useTranslation } from "../../i18n/I18nContext.jsx";
import { buildWeekdayHeatmap, extremeHeatmapCells, totalHeatmapCount } from "../domain/weekdayStats.js";
import { formatClockTime, formatCompactNeso, formatExactNeso, weekdayShortLabel } from "../domain/format.js";

const WEEKDAY_ORDER = [0, 1, 2, 3, 4, 5, 6]; // Sun..Sat -- Date#getUTCDay() order
const LOW_N_THRESHOLD = 5; // plan §3-3: "n が少ないセルは視覚的に弱める（例 n<5）"

/**
 * design/plan §3: 7 (UTC weekday) x 6 (UTC 4h slot) grid of the *median*
 * Expected cost, from `series` = SfHistoryRoot's `fullSeries` (IMPL_PLAN_SH11
 * §3-2: always the full ~150-day series, deliberately never the
 * period-tab-sliced one -- passing `periodSeries` here would be the exact
 * regression the plan warns about: a 7-day slice puts n=1 in every cell).
 * `buildWeekdayHeatmap` (domain/weekdayStats.js) does all the actual
 * aggregation; this component only lays it out and colors it.
 *
 * IMPL_PLAN_SH14 §0-1/§2 (2026-08-05, user decision): reverts IMPL_PLAN_SH11
 * §2's viewer-local-time basis back to a fixed UTC (both the weekday
 * grouping and the column time-of-day labels).
 */
export default function WeekdayHeatmap({ series }) {
  const { t, language } = useTranslation();

  const { cells, columns, total, extremes } = useMemo(() => {
    const { cells, columns } = buildWeekdayHeatmap(series);
    return { cells, columns, total: totalHeatmapCount(cells), extremes: extremeHeatmapCells(cells) };
  }, [series]);

  const cellByKey = useMemo(() => new Map(cells.map((cell) => [`${cell.weekdayIndex}-${cell.bucketSlot}`, cell])), [cells]);

  const { min, max } = useMemo(() => {
    const medians = cells.map((cell) => cell.median).filter((value) => value != null);
    if (!medians.length) return { min: null, max: null };
    return { min: Math.min(...medians), max: Math.max(...medians) };
  }, [cells]);

  return (
    <div className="sfh-summary-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="sfh-field-label">{t("sfhistory.heatmap.title")}</h2>
        {/* plan §3-2: labeled as always-full-period so it never looks like
            it tracks the period tab above it. */}
        <span className="text-xs text-slate-500">{t("sfhistory.heatmap.periodNote")}</span>
      </div>

      {total === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">{t("sfhistory.heatmap.empty")}</p>
      ) : (
        <>
          <div className="sfh-heatmap-grid mt-2" style={{ gridTemplateColumns: `auto repeat(${columns.length}, minmax(0, 1fr))` }}>
            <div className="sfh-heatmap-corner" />
            {columns.map((column) => (
              <div key={column.bucketSlot} className="sfh-heatmap-col-header">
                {formatClockTime(column.hour, column.minute)}
              </div>
            ))}
            {WEEKDAY_ORDER.map((weekdayIndex) => (
              <Fragment key={weekdayIndex}>
                <div className="sfh-heatmap-row-header">{weekdayShortLabel(weekdayIndex, language)}</div>
                {columns.map((column) => {
                  const cell = cellByKey.get(`${weekdayIndex}-${column.bucketSlot}`);
                  const hasData = cell?.median != null;
                  const isLowN = hasData && cell.n < LOW_N_THRESHOLD;
                  const isLowest = hasData && extremes.lowest && cell.weekdayIndex === extremes.lowest.weekdayIndex && cell.bucketSlot === extremes.lowest.bucketSlot;
                  const isHighest = hasData && extremes.highest && cell.weekdayIndex === extremes.highest.weekdayIndex && cell.bucketSlot === extremes.highest.bucketSlot;
                  // plan §3-3: "セルは中央値で色分け（安い＝冷色／高い＝暖色
                  // 等、テーマ変数を使う）" -- interpolated between the
                  // neutral card background (cheapest) and the active
                  // 4-color theme accent (`--theme-focus`, priciest), so
                  // the scale stays correct under every theme color rather
                  // than a fixed hardcoded palette.
                  const ratio = hasData && max != null && max > min ? (cell.median - min) / (max - min) : hasData ? 0.5 : 0;
                  const background = hasData
                    ? `color-mix(in srgb, var(--theme-focus) ${Math.round(8 + ratio * 62)}%, var(--theme-card-bg))`
                    : "var(--theme-card-bg)";
                  const title = hasData
                    ? t("sfhistory.heatmap.cellTooltip", { value: formatExactNeso(cell.median) })
                    : t("sfhistory.heatmap.noData");
                  return (
                    <div
                      key={column.bucketSlot}
                      className={[
                        "sfh-heatmap-cell",
                        isLowN ? "sfh-heatmap-cell-weak" : "",
                        isLowest ? "sfh-heatmap-cell-lowest" : "",
                        isHighest ? "sfh-heatmap-cell-highest" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={{ background }}
                      title={title}
                    >
                      {hasData ? (
                        <>
                          <span className="sfh-heatmap-cell-value">{formatCompactNeso(cell.median)}</span>
                          {isLowest ? <span className="sfh-heatmap-cell-badge sfh-heatmap-cell-badge-low">{t("sfhistory.heatmap.lowestBadge")}</span> : null}
                          {isHighest ? <span className="sfh-heatmap-cell-badge sfh-heatmap-cell-badge-high">{t("sfhistory.heatmap.highestBadge")}</span> : null}
                        </>
                      ) : (
                        <span className="sfh-heatmap-cell-n">--</span>
                      )}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
          {/* plan §3-3/design §11: "断定的な推薦をしない" -- this is the
              only prose next to the grid, and it says only what the grid
              is (median + n), not what to do with it. */}
          <p className="mt-2 text-xs text-slate-500">{t("sfhistory.heatmap.disclaimer")}</p>
        </>
      )}
    </div>
  );
}
