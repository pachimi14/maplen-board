import { Button } from "@/components/ui/button";
import { useTranslation } from "../i18n/I18nContext";

/**
 * Unregistered state (T4b §3): invites the user to search for and pin a
 * character. Does not touch the URL/search text/filters/page itself — it
 * only asks the caller (`RankingListView`) to focus the existing search
 * input (§20-6).
 */
export default function MyCharacterEmptyCta({ onFocusSearch }) {
  const { t } = useTranslation();

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-bold">{t("myCharacters.section")}</h2>
        <p className="text-sm text-slate-400 mt-1">{t("myCharacters.empty.title")}</p>
      </div>
      <Button type="button" className="shrink-0" onClick={onFocusSearch}>
        {t("myCharacters.empty.cta")}
      </Button>
    </div>
  );
}
