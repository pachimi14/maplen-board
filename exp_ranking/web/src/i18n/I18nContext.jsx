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

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(detectLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

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
