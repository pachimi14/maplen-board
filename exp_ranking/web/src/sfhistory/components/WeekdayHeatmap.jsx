import { Fragment, useMemo } from "react";
import { useTranslation } from "../../i18n/I18nContext.jsx";
import { buildWeekdayHeatmap, currentHeatmapCell, extremeHeatmapCells, heatmapSampleRange, totalHeatmapCount } from "../domain/weekdayStats.js";
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

/**
 * design/plan §3: 7 (UTC weekday) x 6 (4h slot) grid of the *median*
 * Expected cost. `buildWeekdayHeatmap` (domain/weekdayStats.js) does all
 * the actual aggregation -- fixed UTC, unaffected by this component's
 * display choices -- this component only lays it out, colors it, and picks
 * which zone to *label* the columns in.
 *
 * IMPL_PLAN_SH29 §4 (2026-08-06, user decision, reverses IMPL_PLAN_SH11
 * §3-2 below): `series` is now `SfHistoryRoot`'s `periodSeries` (the same
 * period-tab-sliced series the chart/stats use), not `fullSeries`. Changing
 * the period tab now changes this grid's `n`/median too -- see
 * `heatmapSampleRange` below for the standard-count disclosure this
 * reversal requires (a 7D period puts n=0-1 in most cells; SH-29 plan
 * §4-1's own worked table).
 * ~~IMPL_PLAN_SH11 §3-2: always the full ~150-day series, deliberately
 * never the period-tab-sliced one.~~ (superseded by SH-29 §4 above --
 * struck through, not deleted, per this repo's "旧文は書き換えない" norm
 * for reversed decisions; see docs/reports/SH11_LOCAL_TIME_HEATMAP.md's own
 * addendum for the same pattern.)
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
 *
 * IMPL_PLAN_SH35 §1/§2 (2026-08-21, user decision): (A) removes the old
 * `n < 5` dimming (`LOW_N_THRESHOLD`/`.sfh-heatmap-cell-weak`) -- SH-29's
 * period-tab linkage above made most cells dim under a short period, which
 * was more confusing than the low-n warning it was meant to convey; the
 * median color-coding (`ratio`/`background` below) is untouched, still the
 * only thing that varies a cell's shade. (B) adds a "this is now" ring
 * (`.sfh-heatmap-cell-current`, an outline -- not a `background` change, so
 * it never fights the median color-coding) on the cell `currentHeatmapCell()`
 * (domain/weekdayStats.js) says the current UTC instant falls in -- computed
 * fresh on every render, no timer (§2-3's accepted trade-off: a long-open
 * tab's ring can go stale).
 */
export default function WeekdayHeatmap({ series }) {
  const { t, language } = useTranslation();

  const { cells, columns, total, extremes, sampleRange } = useMemo(() => {
    const { cells, columns } = buildWeekdayHeatmap(series);
    return {
      cells,
      columns,
      total: totalHeatmapCount(cells),
      extremes: extremeHeatmapCells(cells),
      sampleRange: heatmapSampleRange(cells),
    };
  }, [series]);

  // IMPL_PLAN_SH29 §1/§2-1: the viewer's own zone label, computed once per
  // render (cheap, no network/DOM) -- shared by the axis note below and
  // reused the same way SfHistoryChart's tooltip uses it.
  const zoneLabel = formatTimeZoneLabel();
  const sampleRangeText = sampleRange.low === sampleRange.high ? `${sampleRange.low}` : `${sampleRange.low}–${sampleRange.high}`;

  const cellByKey = useMemo(() => new Map(cells.map((cell) => [`${cell.weekdayIndex}-${cell.bucketSlot}`, cell])), [cells]);

  const { min, max } = useMemo(() => {
    const medians = cells.map((cell) => cell.median).filter((value) => value != null);
    if (!medians.length) return { min: null, max: null };
    return { min: Math.min(...medians), max: Math.max(...medians) };
  }, [cells]);

  // IMPL_PLAN_SH35 §2/§2-3: which cell "now" falls in, recomputed on every
  // render -- not on a timer (plan §2-3's explicit割り切り: a long-open tab's
  // ring can go stale; this is accepted, not hidden -- see the completion
  // report's note on this). No `useMemo` here on purpose: the whole point is
  // to read the current instant fresh each time this component renders
  // (e.g. on a period-tab switch), not to freeze it at mount.
  const current = currentHeatmapCell();

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
      {/* IMPL_PLAN_SH35 §2-2: "凡例か注記で「これが現在」と分かるように
          する。枠だけで意味が伝わる前提にしない" -- a static legend line,
          always shown (not only when a cell happens to render), same
          `sfh-heatmap-cell-current` ring style reused inline so the swatch
          matches what's actually drawn on the grid. */}
      <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
        <span className="sfh-heatmap-legend-current-swatch" aria-hidden="true" />
        <span>{t("sfhistory.heatmap.currentCellLegend")}</span>
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
                  const isLowest = hasData && extremes.lowest && cell.weekdayIndex === extremes.lowest.weekdayIndex && cell.bucketSlot === extremes.lowest.bucketSlot;
                  const isHighest = hasData && extremes.highest && cell.weekdayIndex === extremes.highest.weekdayIndex && cell.bucketSlot === extremes.highest.bucketSlot;
                  // IMPL_PLAN_SH35 §2-1: "どのセルを指すかを計算するだけで、
                  // 集計には触らない" -- compared directly against
                  // `current` (weekdayIndex/bucketSlot), the exact same key
                  // shape every cell already carries. Deliberately shown
                  // even when `!hasData` (plan §2-1 "データが無いセル
                  // （進行中の足など）でも印を付ける" -- "now" is not about
                  // whether a bucket has confirmed data yet).
                  const isCurrent = weekdayIndex === current.weekdayIndex && column.bucketSlot === current.bucketSlot;
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
                  // IMPL_PLAN_SH35 §2-2: "凡例か注記で「これが現在」と分かる
                  // ようにする。枠だけで意味が伝わる前提にしない" +
                  // "スクリーンリーダー向けに...テキストでも示す（aria-label
                  // / title のいずれか）" -- the current-cell text is
                  // appended to the same `title` every cell already has
                  // (native tooltip = also read by most screen readers),
                  // rather than adding a second, easy-to-miss attribute.
                  const baseTitle = hasData
                    ? t("sfhistory.heatmap.cellTooltip", { value: formatExactNeso(cell.median) })
                    : t("sfhistory.heatmap.noData");
                  const title = isCurrent ? `${baseTitle} (${t("sfhistory.heatmap.currentCellLabel")})` : baseTitle;
                  return (
                    <div
                      key={column.bucketSlot}
                      className={[
                        "sfh-heatmap-cell",
                        isLowest ? "sfh-heatmap-cell-lowest" : "",
                        isHighest ? "sfh-heatmap-cell-highest" : "",
                        isCurrent ? "sfh-heatmap-cell-current" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={{ background }}
                      title={title}
                      aria-label={title}
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
          {/* IMPL_PLAN_SH29 §4-1: the standard-count disclosure the period
              linkage (§4) requires -- replaces the old always-full-period
              note (SH-11 §3-2's "not linked to the period tab", now false)
              with the actual per-cell sample spread for whichever period is
              selected, so "中央値" never quietly means "one point". */}
          <p className="mt-2 text-xs text-slate-500">{t("sfhistory.heatmap.periodNote", { sampleRange: sampleRangeText })}</p>
          {/* plan §3-3/design §11: "断定的な推薦をしない" -- this is the
              only other prose next to the grid, and it says only what the
              grid is (median + n), not what to do with it. */}
          <p className="mt-1 text-xs text-slate-500">{t("sfhistory.heatmap.disclaimer")}</p>
        </>
      )}
    </div>
  );
}
