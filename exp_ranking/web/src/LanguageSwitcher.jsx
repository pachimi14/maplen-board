import React from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "./i18n/I18nContext";

const OPTIONS = [
  { code: "ja", labelKey: "lang.ja" },
  { code: "en", labelKey: "lang.en" },
];

export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useTranslation();

  return (
    <div
      className="flex items-center gap-1"
      role="group"
      aria-label={t("lang.switch")}
    >
      {OPTIONS.map((option) => (
        <Button
          key={option.code}
          type="button"
          variant={language === option.code ? "default" : "outline"}
          className={
            language === option.code
              ? "h-8 px-3 text-xs"
              : "h-8 px-3 text-xs border-slate-700 bg-slate-950"
          }
          onClick={() => setLanguage(option.code)}
        >
          {t(option.labelKey)}
        </Button>
      ))}
    </div>
  );
}
