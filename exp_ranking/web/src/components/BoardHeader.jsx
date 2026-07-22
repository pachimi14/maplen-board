import LanguageSwitcher from "../LanguageSwitcher";
import { useTranslation } from "../i18n/I18nContext.jsx";
import { ThemePicker } from "../taskManager/components/AppToolbar.jsx";

export function SiteHeader({ active = "", variant = "light", theme = null, onThemeChange = null }) {
  const { t } = useTranslation();
  const dark = variant === "dark";
  const shell = dark ? "border-slate-800 bg-slate-950/95" : "border-slate-200/80 bg-white/90";
  const brand = dark ? "text-cyan-300" : "text-emerald-600";
  const idle = dark ? "text-slate-400 hover:bg-slate-900 hover:text-white" : "text-slate-600 hover:bg-slate-100 hover:text-emerald-700";
  const selected = dark ? "bg-slate-800 text-cyan-200" : "bg-emerald-50 text-emerald-700";

  return (
    <header className={`relative z-[100] overflow-visible border-b backdrop-blur ${shell}`}>
      <div className="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:flex-nowrap sm:gap-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3 sm:gap-5">
          <a href="#/" className={`shrink-0 text-[12.75px] font-bold tracking-[0.26em] ${brand}`}>LULUMI TOOLS</a>
          <nav aria-label="Lulumi Tools" className="flex min-w-0 items-center gap-1">
            <a href="#/" aria-current={active === "ranking" ? "page" : undefined} className={`rounded-lg px-2.5 py-2 text-xs font-semibold transition sm:px-3 sm:text-sm ${active === "ranking" ? selected : idle}`}>EXP Ranking</a>
            <a href="#/dashboard" aria-current={active === "daily" ? "page" : undefined} className={`rounded-lg px-2.5 py-2 text-xs font-semibold transition sm:px-3 sm:text-sm ${active === "daily" ? selected : idle}`}>{t("app.openDailyDashboard")}</a>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemePicker value={theme} onChange={onThemeChange} />
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}

export default function BoardHeader({ meta, loadError, scheduledUpdateLabel, t }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-[25.5px] font-semibold leading-[34px] tracking-tight">MapleN Exp Ranking</h1>
        {meta.demoGains ? (
          <p className="mt-1 text-sm text-amber-300">
            {t("app.demoGains", { days: meta.demoGainDays || "?" })}
          </p>
        ) : null}
      </div>
      <div className="shrink-0 text-right md:pb-1">
        {scheduledUpdateLabel ? (
          <p className="text-sm text-slate-400 md:text-base">{scheduledUpdateLabel}</p>
        ) : null}
      </div>
    </div>
  );
}
