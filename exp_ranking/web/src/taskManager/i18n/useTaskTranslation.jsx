import { useMemo } from "react";
import { useTranslation as useSiteTranslation } from "../../i18n/I18nContext.jsx";
import en from "./locales/en.json";
import es from "./locales/es.json";
import ja from "./locales/ja.json";
import th from "./locales/th.json";
import vi from "./locales/vi.json";
import zhTW from "./locales/zh-TW.json";

const MESSAGES = { ja, en, es, th, vi, "zh-TW": zhTW };

function getNested(object, path) {
  return path.split(".").reduce((current, key) => current?.[key], object);
}

function interpolate(template, vars = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] == null ? "" : String(vars[key]),
  );
}

export function useTranslation() {
  const site = useSiteTranslation();
  return useMemo(() => {
    const t = (key, vars) => {
      const local = getNested(MESSAGES[site.language], key) ?? getNested(MESSAGES.ja, key);
      return typeof local === "string" ? interpolate(local, vars) : site.t(key, vars);
    };
    t.language = site.language;
    return { ...site, t };
  }, [site]);
}
