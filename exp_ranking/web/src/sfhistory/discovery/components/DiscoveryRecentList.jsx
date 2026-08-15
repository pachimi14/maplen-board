import { useTranslation } from "../../../i18n/I18nContext.jsx";
import { formatTooltipDate } from "../../domain/format.js";
import { groupRecentByItem, starForUpgrade } from "../domain/bands.js";

/** plan §2 C "最近終了" / §5(k): bands that flipped DISCOVERY -> CHANGE
 * within the configured window. `windowStart`/`windowEnd` are shown as an
 * explicit RANGE, never collapsed to one invented instant (plan §2 B: "遷移
 * の時刻は「5分の幅」までしか特定できない...この幅を隠して「何時何分に
 * 終わった」と書かないこと"). */
export default function DiscoveryRecentList({ items, days }) {
  const { t, language } = useTranslation();
  const groups = groupRecentByItem(items);

  if (groups.length === 0) {
    return <p className="text-sm text-slate-500">{t("sfhistoryDiscovery.recent.empty", { days })}</p>;
  }

  return (
    <ul className="space-y-3">
      {groups.map((group) => (
        <li key={group.itemId} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="font-semibold text-slate-100">{group.itemName}</div>
          <ul className="mt-1.5 space-y-1">
            {group.bands.map((band) => (
              <li key={band.itemUpgrade} className="text-sm text-slate-300">
                <span className="text-slate-100">☆{starForUpgrade(band.itemUpgrade)}</span>{" "}
                {t("sfhistoryDiscovery.recent.endedBetween", {
                  start: formatTooltipDate(band.windowStart, { locale: language }),
                  end: formatTooltipDate(band.windowEnd, { locale: language }),
                })}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
