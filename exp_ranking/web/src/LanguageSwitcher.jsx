import React from "react";
import { useTranslation } from "./i18n/I18nContext";
import { LANGUAGES } from "./i18n/languages";

export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useTranslation();

  return (
    <label className="inline-flex items-center gap-2">
      <span className="sr-only">{t("lang.switch")}</span>
      <select
        value={language}
        onChange={(event) => setLanguage(event.target.value)}
        aria-label={t("lang.switch")}
        className="h-8 min-w-[8.5rem] rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-xs text-slate-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
      >
        {LANGUAGES.map((option) => (
          <option key={option.code} value={option.code} className="bg-slate-950">
            {option.nativeLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
