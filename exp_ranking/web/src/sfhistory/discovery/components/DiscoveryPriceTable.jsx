import { useTranslation } from "../../../i18n/I18nContext.jsx";
import { formatTooltipDate } from "../../domain/format.js";
import { buildBandRows } from "../domain/bands.js";
import { DISCOVERY_TABLE_MIN_WIDTH_PX } from "../domain/tableColumns.js";
import { formatDiscoveryPrice } from "../domain/priceFormat.js";
import DiscoveryTableColgroup from "./DiscoveryTableColgroup.jsx";

/** plan §1/§5(h): the full ☆1-25 price/step table for one monitored
 * representative, with a "Forming" badge on every band whose price has not
 * settled yet -- this page's own addition (plan §3: "既存のチャートページに
 * バッジを出さない", so it lives only here). IMPL_PLAN_SH33 §2 (C): the
 * badge text is "Forming"/"Settled" (`prices.formingBadge`/
 * `prices.settledBadge`) -- the underlying `row.isDiscovery`/`row.step`
 * fields still carry the upstream `STEP_TYPE_DISCOVERY`/`STEP_TYPE_CHANGE`
 * literal (bands.js/the API), unchanged; only the label shown for them is
 * renamed here.
 *
 * Post-review follow-up (実機レビュー): the price column is right-aligned +
 * `tabular-nums` so every row's decimal point lines up vertically --
 * `formatDiscoveryPrice` now always emits exactly 6 decimals (never
 * trimmed, see that function's own header) specifically so a fixed-width
 * column can do this. The "NESO" unit itself moved out of every row and
 * into this column's own header (`prices.price` = "Price (NESO)"-style, 6
 * locales) -- repeating it on all 25 rows was both redundant and part of
 * what made the decimal point ragged (a variable-width suffix trailing a
 * variable-width number).
 *
 * Post-review follow-up 2 (実機レビュー, "SF内の帯がいつ形成済みに変わった
 * のか"): the old `priceWindow` column (the same polling timestamp
 * repeated on all 25 rows, duplicating the "observed as of" line above the
 * table) is replaced with `settledAt` -- THIS band's own observed
 * DISCOVERY -> CHANGE flip (`row.windowStart`/`row.windowEnd`,
 * `db.find_discovery_transitions_for_item` server-side). `-` for a band
 * that has not shown that flip yet (still forming, or -- indistinguishably
 * -- already settled before monitoring started; never a guess, plan:
 * "推測して埋めない"). Shown as an explicit two-endpoint RANGE, never a
 * single instant (plan: "遷移の時刻は「5分の幅」までしか特定できない...
 * 「何時何分に切り替わった」と断定する表示にしない" -- same discipline
 * `DiscoveryRecentList.jsx`'s own `endedBetween` already follows).
 *
 * Post-review follow-up 3 (実機レビュー, 本番): `table-layout: fixed` +
 * `DiscoveryTableColgroup` (the SAME colgroup `DiscoveryCubeTable.jsx`
 * renders, both reading `tableColumns.js`'s one set of widths) -- with the
 * previous `table-layout: auto`, this table's own ☆-number-length first
 * column sized itself completely independently of the cube table's
 * cube-name-length first column below it, so the two tables' columns did
 * not line up even though both share the same left/width. Wrapped in its
 * own `overflow-x-auto` container with a `min-width` so a narrow viewport
 * scrolls THIS table, never the page (plan (x)). */
export default function DiscoveryPriceTable({ bands, upgradeCount = 25 }) {
  const { t, language } = useTranslation();
  const rows = buildBandRows(bands, upgradeCount);

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-sm" style={{ minWidth: `${DISCOVERY_TABLE_MIN_WIDTH_PX}px` }}>
        <DiscoveryTableColgroup />
        <thead>
          <tr className="text-left text-slate-400">
            <th className="py-1.5 pr-3 font-medium">{t("sfhistoryDiscovery.prices.star")}</th>
            <th className="py-1.5 pr-3 font-medium text-right">{t("sfhistoryDiscovery.prices.price")}</th>
            <th className="py-1.5 pr-3 font-medium">{t("sfhistoryDiscovery.prices.status")}</th>
            <th className="py-1.5 font-medium">{t("sfhistoryDiscovery.prices.settledAt")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((row) => {
            const hasSettledWindow = row.windowStart != null && row.windowEnd != null;
            const rangeVars = hasSettledWindow
              ? {
                  start: formatTooltipDate(row.windowStart, { locale: language }),
                  end: formatTooltipDate(row.windowEnd, { locale: language }),
                }
              : null;
            return (
              <tr key={row.itemUpgrade}>
                <td className="py-1.5 pr-3 text-slate-200">☆{row.star}</td>
                <td
                  className="py-1.5 pr-3 text-slate-100 text-right tabular-nums"
                  title={row.price != null ? formatDiscoveryPrice(row.price) : undefined}
                >
                  {formatDiscoveryPrice(row.price)}
                </td>
                <td className="py-1.5 pr-3">
                  {row.isDiscovery ? (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
                      {t("sfhistoryDiscovery.prices.formingBadge")}
                    </span>
                  ) : row.step ? (
                    <span className="text-xs text-slate-500">{t("sfhistoryDiscovery.prices.settledBadge")}</span>
                  ) : (
                    <span className="text-xs text-slate-600">{t("sfhistoryDiscovery.prices.noData")}</span>
                  )}
                </td>
                <td
                  className="py-1.5 text-slate-400"
                  title={hasSettledWindow ? t("sfhistoryDiscovery.prices.settledRangeTooltip", rangeVars) : undefined}
                >
                  {hasSettledWindow ? t("sfhistoryDiscovery.prices.settledRange", rangeVars) : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
