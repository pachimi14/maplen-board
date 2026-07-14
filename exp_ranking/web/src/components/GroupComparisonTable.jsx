import { Button } from "@/components/ui/button";
import { formatExp } from "../rankingUtils";

/**
 * §22.5: the group comparison table (character/job/server/daily/weekly/
 * monthly/selected-period total-or-average). `rows` come from
 * `buildGroupComparisonRows` (pure, already computed) — this component only
 * renders them. Horizontally scrollable on narrow screens so the table
 * itself never forces the page to scroll sideways (§22.8).
 */
export default function GroupComparisonTable({ rows, mode, onModeChange, periodLabel, t }) {
  if (!rows.length) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-sm">{t("group.compareTable.title")}</h4>
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <span>
            {t("group.compareTable.periodColumn")}
            {periodLabel ? ` (${periodLabel})` : ""}
          </span>
          <Button
            type="button"
            size="sm"
            variant={mode === "total" ? "default" : "outline"}
            className={mode === "total" ? "h-7" : "h-7 border-slate-700"}
            onClick={() => onModeChange("total")}
          >
            {t("group.compareTable.modeTotal")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "average" ? "default" : "outline"}
            className={mode === "average" ? "h-7" : "h-7 border-slate-700"}
            onClick={() => onModeChange("average")}
          >
            {t("group.compareTable.modeAverage")}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-800">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-950 text-slate-400">
            <tr>
              <th className="text-left p-2.5">{t("table.character")}</th>
              <th className="text-left p-2.5">{t("filter.job")}</th>
              <th className="text-left p-2.5">{t("table.server")}</th>
              <th className="text-right p-2.5">{t("table.daily")}</th>
              <th className="text-right p-2.5">{t("table.weekly")}</th>
              <th className="text-right p-2.5">{t("table.monthly")}</th>
              <th className="text-right p-2.5">
                {t("group.compareTable.periodColumn")} ({mode === "average" ? t("group.compareTable.modeAverage") : t("group.compareTable.modeTotal")})
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-slate-800">
                <td className="p-2.5 font-semibold">{row.name}</td>
                <td className="p-2.5 text-slate-400">{row.job ?? "-"}</td>
                <td className="p-2.5 text-slate-400">{row.worldId ?? "-"}</td>
                <td className="p-2.5 text-right tabular-nums">
                  {row.daily != null ? `+${formatExp(row.daily)}` : "-"}
                </td>
                <td className="p-2.5 text-right tabular-nums">
                  {row.weekly != null ? `+${formatExp(row.weekly)}` : "-"}
                </td>
                <td className="p-2.5 text-right tabular-nums">
                  {row.monthly != null ? `+${formatExp(row.monthly)}` : "-"}
                </td>
                <td className="p-2.5 text-right tabular-nums font-semibold">
                  {row.periodValue != null ? `+${formatExp(row.periodValue)}` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
