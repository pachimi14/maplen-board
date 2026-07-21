import { useEffect } from "react";
import { DASHBOARD_THEME_COLORS, DASHBOARD_THEME_DEPTHS, setDashboardThemeColor, setDashboardThemeDepth } from "../domain/dashboardModel.js";
import { useTranslation } from "../i18n/useTaskTranslation.jsx";
import { ROUTES } from "../routing/hashRoute.js";
import { useDashboardStore } from "../storage/useDashboardStore.js";

const NAV_ITEMS = [
  ["dashboard", ROUTES.dashboard],
  ["tasks", ROUTES.tasks],
  ["schedule", ROUTES.schedule],
];

export default function AppToolbar({ active }) {
  const { t } = useTranslation();
  const dashboardStore = useDashboardStore();
  const color = dashboardStore.state.themeColor || "green";
  const depth = dashboardStore.state.themeDepth || "standard";

  useEffect(() => {
    document.documentElement.dataset.themeColor = color;
    document.documentElement.dataset.themeDepth = depth;
  }, [color, depth]);

  return (
    <div className="flex max-w-full min-w-0 items-center gap-2">
      <nav aria-label={t("nav.label")} className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
        {NAV_ITEMS.map(([name, href]) => (
          <a key={name} href={href} aria-current={active === name ? "page" : undefined} className={`rounded-lg px-2 py-2 text-center text-xs font-medium transition sm:px-3 sm:text-sm ${active === name ? "bg-white text-emerald-700 shadow-sm" : "text-slate-600 hover:bg-white/70 hover:text-slate-900"}`}>
            {t(`nav.${name}`)}
          </a>
        ))}
      </nav>
      <details className="theme-picker relative">
        <summary className="theme-picker-button" aria-label={t("theme.label")} title={t("theme.label")}>🎨</summary>
        <div className="absolute right-0 z-40 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
          <fieldset>
            <legend className="mb-2 text-xs font-semibold text-slate-600">{t("theme.color")}</legend>
            <div className="grid grid-cols-4 gap-3">
              {DASHBOARD_THEME_COLORS.map((name) => (
                <button key={name} type="button" className={`theme-swatch theme-swatch-${name} ${color === name ? "is-selected" : ""}`} aria-label={t(`theme.${name}`)} title={t(`theme.${name}`)} aria-pressed={color === name} onClick={() => dashboardStore.update((state) => setDashboardThemeColor(state, name))}>
                  {color === name ? "✓" : ""}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="mt-4 border-t border-slate-100 pt-3">
            <legend className="mb-2 text-xs font-semibold text-slate-600">{t("theme.depth")}</legend>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
              {DASHBOARD_THEME_DEPTHS.map((name) => (
                <button key={name} type="button" className={`rounded-lg px-2 py-1.5 text-xs font-semibold transition ${depth === name ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`} aria-pressed={depth === name} onClick={() => dashboardStore.update((state) => setDashboardThemeDepth(state, name))}>
                  {t(`theme.${name}`)}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </details>
    </div>
  );
}
