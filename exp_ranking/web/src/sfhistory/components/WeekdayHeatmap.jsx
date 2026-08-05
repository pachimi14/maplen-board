import { Fragment, useMemo } from "react";
import { useTranslation } from "../../i18n/I18nContext.jsx";
import { buildWeekdayHeatmap, extremeHeatmapCells, totalHeatmapCount } from "../domain/weekdayStats.js";
import {
  formatClockTime,
  formatCompactNeso,
  formatExactNeso,
  formatLocalClockTime,
  formatTimeZoneLabel,
  weekdayShortLabel,
} from "../domain/format.js";

// IMPL_PLAN_SH14 §4 (2026-08-05, user decision): the grid's origin is now
// Thursday UTC 00:00 (top-left) -- rows Thu->Fri->Sat->Sun->Mon->Tue->Wed,
// still in `Date#getUTCDay()` index terms (0=Sun..6=Sat) so it lines up
// directly with `buildWeekdayHeatmap`'s cell keys and `weekdayShortLabel`'s
// own index convention. This is a *display order* change only -- each
// cell is still looked up from `cellByKey` by its (weekdayIndex, bucketSlot)
// key below, so its median/n (computed in domain/weekdayStats.js) are
// byte-for-byte unaffected by which row order they're rendered in -- only
// the columns (already a fixed 00/04/08/12/16/20 UTC sequence since
// IMPL_PLAN_SH14 §2) combine with this row order to put Thu 00:00 UTC at
// the top-left cell.
const WEEKDAY_ORDER = [4, 5, 6, 0, 1, 2, 3];
const LOW_N_THRESHOLD = 5; // plan §3-3: "n が少ないセルは視覚的に弱める（例 n<5）"

/**
 * design/plan §3: 7 (UTC weekday) x 6 (4h slot) grid of the *median*
 * Expected cost. `buildWeekdayHeatmap` (domain/weekdayStats.js) does all
 * the actual aggregation -- fixed UTC, unaffected by this component's
 * display choices -- this component only lays it out, colors it, and picks
 * which zone to *label* the columns in.
 *
 * IMPL_PLAN_SH11 §3-2: `series` is `SfHistoryRoot`'s `fullSeries`, always
 * the full ~150-day series, deliberately never the period-tab-sliced one --
 * passing `periodSeries` here would put n=1 in every cell for a 7-day tab.
 *
 * IMPL_PLAN_SH14 §0-1/§2 (2026-08-05, user decision): reverts IMPL_PLAN_SH11
 * §2's viewer-local-time basis back to a fixed UTC for the *grouping*
 * (weekday/hour a bucket lands in). §4: rows are ordered Thu-first (see
 * `WEEKDAY_ORDER` above) so the top-left cell is Thu 00:00 UTC.
 *
 * IMPL_PLAN_SH29 §2 (2026-08-06, user decision, re-adds a viewer-local
 * *display* on top of SH-14's fixed-UTC grouping -- NOT a revert of SH-14):
 * column headers now show the viewer's own local time as the primary label
 * (`formatLocalClockTime`), with the original fixed UTC value kept directly
 * underneath in smaller text (`formatClockTime`, unchanged call). The
 * *grouping* below (`buildWeekdayHeatmap`, `WEEKDAY_ORDER`, `columns`) is
 * completely untouched by this -- only these header labels changed, per
 * plan §2's "★集計は UTC 基準のまま変えない". Row (weekday) headers stay
 * UTC-only (plan §2: "行の曜日ラベルは UTC 基準のまま") -- the axis note
 * below the title (§2-1) is what discloses that split so a large-offset
 * viewer is never left unable to tell which axis is in which zone.
 *
 * IMPL_PLAN_SH18 §4 (2026-08-05, user decision, reverses design §8):
 * `buildWeekdayHeatmap` now keys each cell by its bucket's *end* weekday/
 * hour rather than its start (same reasoning as the chart's
 * `bucketDisplayDate` -- the stored value is really the bucket's last
 * instant). A `水 20:00–木 00:00` bucket now lands in the `木`/`00:00`
 * cell, not `水`/`20:00`. This component's own row order (`WEEKDAY_ORDER`,
 * still Thu-first) and column set (still the fixed 00/04/08/12/16/20
 * UTC values) are unchanged by this -- only *which* cell a given bucket's
 * data lands in shifted by one column/row, which is exactly what keeps
 * the top-left cell "Thu 00:00 UTC" meaning "the bucket ending at Thu
 * 00:00 UTC" (i.e. the `水 20:00–木 00:00` bucket) rather than "the bucket
 * starting at Thu 00:00 UTC".
 */
export default function WeekdayHeatmap({ series }) {
  const { t, language } = useTranslation();

  const { cells, columns, total, extremes } = useMemo(() => {
    const { cells, columns } = buildWeekdayHeatmap(series);
    return { cells, columns, total: totalHeatmapCount(cells), extremes: extremeHeatmapCells(cells) };
  }, [series]);

  // IMPL_PLAN_SH29 §1/§2-1: the viewer's own zone label, computed once per
  // render (cheap, no network/DOM) -- shared by the axis note below and
  // reused the same way SfHistoryChart's tooltip uses it.
  const zoneLabel = formatTimeZoneLabel();

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
        {/* IMPL_PLAN_SH29 §2-1: discloses which axis is in which zone --
            columns are now the viewer's local time (with the zone spelled
            out here), rows stay the UTC weekday `buildWeekdayHeatmap`
            actually grouped by. */}
        <span className="text-xs text-slate-500">{t("sfhistory.heatmap.axisNote", { zone: zoneLabel })}</span>
      </div>

      {total === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">{t("sfhistory.heatmap.empty")}</p>
      ) : (
        <>
          <div className="sfh-heatmap-grid mt-2" style={{ gridTemplateColumns: `auto repeat(${columns.length}, minmax(0, 1fr))` }}>
            <div className="sfh-heatmap-corner" />
            {columns.map((column) => (
              // IMPL_PLAN_SH29 §2/§2-1: local time is the primary label (plan
              // §2/(b): "JSTなら9:00を左上のUTC0:00のところに表示する"), the
              // original fixed-UTC label (`formatClockTime`, unchanged) stays
              // directly underneath, smaller -- §2-1's "UTC を消さない".
              // Neither line changes which `column`/cell this header sits
              // above; only the label text.
              <div key={column.bucketSlot} className="sfh-heatmap-col-header">
                <span className="sfh-heatmap-col-header-local">{formatLocalClockTime(column.hour, column.minute)}</span>
                <span className="sfh-heatmap-col-header-utc">{formatClockTime(column.hour, column.minute)} UTC</span>
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
