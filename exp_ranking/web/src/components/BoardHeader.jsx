import LanguageSwitcher from "../LanguageSwitcher";

export default function BoardHeader({ meta, loadError, scheduledUpdateLabel, t }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="text-sm text-slate-400">Lulumi Tools</p>
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight">MapleN Exp Ranking</h1>
        {meta.demoGains ? (
          <p className="text-amber-300 text-sm mt-1">
            {t("app.demoGains", { days: meta.demoGainDays || "?" })}
          </p>
        ) : null}
      </div>
      <div className="text-right md:pb-1 shrink-0 space-y-2">
        <LanguageSwitcher />
        <div className="space-y-0.5">
          <p className="text-xs md:text-sm text-slate-500">
            {meta.rankingMinLevel
              ? `Lv.${meta.rankingMinLevel}+`
              : meta.rankingTopN
                ? t("app.fetchedCount", { count: meta.rankingTopN })
                : null}
          </p>
          {scheduledUpdateLabel ? (
            <p className="text-slate-400 text-sm md:text-base">{scheduledUpdateLabel}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
