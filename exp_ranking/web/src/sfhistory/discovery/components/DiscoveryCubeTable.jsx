import { useTranslation } from "../../../i18n/I18nContext.jsx";
import { formatTooltipDate } from "../../domain/format.js";
import { buildCubeRows } from "../domain/bands.js";
import { DISCOVERY_TABLE_MIN_WIDTH_PX } from "../domain/tableColumns.js";
import { formatDiscoveryPrice } from "../domain/priceFormat.js";
import DiscoveryTableColgroup from "./DiscoveryTableColgroup.jsx";

/** IMPL_PLAN_SH34 §4: the cube (potential) counterpart of
 * DiscoveryPriceTable.jsx, placed directly below it on the same page. Same
 * shape/words as that table (plan: "SF 表と同じ見た目・同じ語にする...別の
 * 用語・別の書式を作らない") -- reuses every `sfhistoryDiscovery.prices.*`
 * key the two tables share (price/status/settledAt/settledRange/
 * formingBadge/settledBadge/noData); only the first column differs (a cube
 * name instead of a ☆ number -- plan §2-2: never translated, the code
 * itself when unresolved).
 *
 * Post-review follow-up (実機レビュー): NO section heading above the table
 * -- the SF table above has none either (only its own column header, "Star"
 * / 星), so a "Cubes" section heading here produced a "キューブ" ->
 * "キューブ" doubled label the moment the "Cube" column header sat right
 * below it. Same structure as the SF table: the column header alone
 * ("Cube"/キューブなど) is what distinguishes this table -- no separate
 * `sfhistoryDiscovery.cubes.tableHeading` key exists any more (removed
 * outright, not emptied, same discipline SH-33 used for the page's own
 * `pageTitle` heading).
 *
 * Post-review follow-up 2 (実機レビュー, 本番): `table-layout: fixed` +
 * `DiscoveryTableColgroup` -- the SAME colgroup `DiscoveryPriceTable.jsx`
 * renders, both reading `tableColumns.js`'s one set of widths, so this
 * table's own cube-name-length first column ("Bonus Potential Cube") can no
 * longer size itself independently of the SF table's ☆-number-length first
 * column above it (the previous `table-layout: auto` behavior, which is
 * exactly what made the two tables' columns drift apart). Wrapped in its
 * own `overflow-x-auto` container with a `min-width` so a narrow viewport
 * scrolls THIS table, never the page (plan (x)).
 *
 * Renders nothing at all when there is no cube data for this item (plan
 * §4: "キューブが1件も無い装備では、表ごと出さない" -- no empty table). */
export default function DiscoveryCubeTable({ cubes }) {
  const { t, language } = useTranslation();
  const rows = buildCubeRows(cubes);

  if (rows.length === 0) return null;

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full table-fixed text-sm" style={{ minWidth: `${DISCOVERY_TABLE_MIN_WIDTH_PX}px` }}>
        <DiscoveryTableColgroup />
        <thead>
          <tr className="text-left text-slate-400">
            <th className="py-1.5 pr-3 font-medium">{t("sfhistoryDiscovery.cubes.cube")}</th>
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
              <tr key={row.cubeItemId}>
                <td className="py-1.5 pr-3 text-slate-200">{row.cubeName}</td>
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
