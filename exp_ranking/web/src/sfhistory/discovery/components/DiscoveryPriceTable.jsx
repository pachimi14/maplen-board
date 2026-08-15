import { useTranslation } from "../../../i18n/I18nContext.jsx";
import { formatTooltipDate } from "../../domain/format.js";
import { buildBandRows } from "../domain/bands.js";
import { formatDiscoveryPrice } from "../domain/priceFormat.js";

/** plan §1/§5(h): the full ☆1-25 price/step table for one monitored
 * representative, with a "Forming" badge on every band whose price has not
 * settled yet -- this page's own addition (plan §3: "既存のチャートページに
 * バッジを出さない", so it lives only here). IMPL_PLAN_SH33 §2 (C): the
 * badge text is "Forming"/"Settled" (`prices.formingBadge`/
 * `prices.settledBadge`) -- the underlying `row.isDiscovery`/`row.step`
 * fields still carry the upstream `STEP_TYPE_DISCOVERY`/`STEP_TYPE_CHANGE`
 * literal (bands.js/the API), unchanged; only the label shown for them is
 * renamed here. */
export default function DiscoveryPriceTable({ bands, upgradeCount = 25 }) {
  const { t, language } = useTranslation();
  const rows = buildBandRows(bands, upgradeCount);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-slate-400">
          <th className="py-1.5 pr-3 font-medium">{t("sfhistoryDiscovery.prices.star")}</th>
          <th className="py-1.5 pr-3 font-medium">{t("sfhistoryDiscovery.prices.price")}</th>
          <th className="py-1.5 pr-3 font-medium">{t("sfhistoryDiscovery.prices.status")}</th>
          <th className="py-1.5 font-medium">{t("sfhistoryDiscovery.prices.priceWindow")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-800">
        {rows.map((row) => (
          <tr key={row.itemUpgrade}>
            <td className="py-1.5 pr-3 text-slate-200">☆{row.star}</td>
            <td className="py-1.5 pr-3 text-slate-100 tabular-nums" title={row.price != null ? formatDiscoveryPrice(row.price) : undefined}>
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
            <td className="py-1.5 text-slate-400">
              {row.priceAt ? formatTooltipDate(row.priceAt, { locale: language }) : "--"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
