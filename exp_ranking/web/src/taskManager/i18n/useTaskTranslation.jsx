import { useMemo } from "react";
import { useTranslation as useSiteTranslation } from "../../i18n/I18nContext.jsx";
import ja from "./locales/ja.json";

const MESSAGES = { ja };

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
  return useMemo(() => ({
    ...site,
    t(key, vars) {
      const local = getNested(MESSAGES[site.language], key) ?? getNested(MESSAGES.ja, key);
      return typeof local === "string" ? interpolate(local, vars) : site.t(key, vars);
    },
  }), [site]);
}
