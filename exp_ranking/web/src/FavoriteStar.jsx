import React from "react";
import { Star } from "lucide-react";
import { useTranslation } from "./i18n/I18nContext";

export default function FavoriteStar({ active, onToggle, size = 18, className = "" }) {
  const { t } = useTranslation();
  const label = active ? t("favorite.remove") : t("favorite.add");

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={`inline-flex items-center justify-center rounded-lg p-1 transition hover:bg-slate-800/80 ${className}`}
    >
      <Star
        size={size}
        className={
          active
            ? "fill-amber-400 text-amber-400"
            : "text-slate-500 hover:text-amber-300"
        }
      />
    </button>
  );
}
