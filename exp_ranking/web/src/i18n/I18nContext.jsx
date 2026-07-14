import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { detectLanguage, STORAGE_KEY } from "./detectLanguage.js";
import en from "./locales/en.json";
import es from "./locales/es.json";
import ja from "./locales/ja.json";
import th from "./locales/th.json";
import vi from "./locales/vi.json";
import zhTW from "./locales/zh-TW.json";
import { SUPPORTED_LANGUAGE_CODES } from "./languages.js";

const MESSAGES = {
  ja,
  en,
  "zh-TW": zhTW,
  th,
  vi,
  es,
};

function getNested(obj, path) {
  return path.split(".").reduce((current, key) => current?.[key], obj);
}

function interpolate(template, vars = {}) {
  if (typeof template !== "string") {
    return "";
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : ""
  );
}

const I18nContext = createContext(null);

// Static English baseline (must match exp_ranking/web/index.html), used as a
// fallback so runtime meta updates never leave the tab title/description
// blank or throw if a locale key is missing/unresolved.
const FALLBACK_META_TITLE = "Lulumi Tools | MapleStory N EXP Ranking";
const FALLBACK_META_DESCRIPTION =
  "Track daily, weekly, and monthly EXP rankings for MapleStory N characters, with detailed progress history and comparison tools.";

function updateDocumentMeta(t) {
  try {
    const title = t("app.metaTitle");
    document.title = title && title !== "app.metaTitle" ? title : FALLBACK_META_TITLE;

    const description = t("app.metaDescription");
    const descriptionEl = document.querySelector('meta[name="description"]');
    if (descriptionEl) {
      descriptionEl.setAttribute(
        "content",
        description && description !== "app.metaDescription"
          ? description
          : FALLBACK_META_DESCRIPTION
      );
    }
  } catch {
    // Never let meta updates break rendering; static index.html already
    // carries the English baseline as a safety net.
  }
}

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(detectLanguage);

  const setLanguage = useCallback((next) => {
    if (!SUPPORTED_LANGUAGE_CODES.includes(next)) {
      return;
    }
    setLanguageState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next;
  }, []);

  const t = useCallback(
    (key, vars) => {
      const template =
        getNested(MESSAGES[language], key) ??
        getNested(MESSAGES.en, key) ??
        key;
      return interpolate(template, vars);
    },
    [language]
  );

  useEffect(() => {
    document.documentElement.lang = language;
    updateDocumentMeta(t);
  }, [language, t]);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t,
      translateAlliance: (name) => t(`alliance.${name}`, {}) || name,
      translateBranch: (name) => t(`branch.${name}`, {}) || name,
    }),
    [language, setLanguage, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useTranslation must be used within I18nProvider");
  }
  return context;
}

export function useGainPeriodLabel(period) {
  const { t } = useTranslation();
  return t(`period.${period}`);
}
