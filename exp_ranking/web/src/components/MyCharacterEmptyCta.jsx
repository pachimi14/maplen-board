import CharacterSearchPicker from "../CharacterSearchPicker";
import { useTranslation } from "../i18n/I18nContext";

/**
 * Unregistered state (T4b §3, revised §22.13 #3). Used to redirect the
 * user to the main ranking list's search box; now searches and pins a
 * character directly here instead — reusing the existing
 * `CharacterSearchPicker` + `useProfile().pin` (wired by the caller via
 * `onSelect`), removing that round trip.
 */
export default function MyCharacterEmptyCta({ characters, onSelect, error }) {
  const { t } = useTranslation();

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-5 sm:p-6 space-y-3">
      <div>
        <h2 className="text-lg font-bold">{t("myCharacters.section")}</h2>
        <p className="text-sm text-slate-400 mt-1">{t("myCharacters.empty.title")}</p>
      </div>
      <div className="space-y-1.5">
        <div className="text-xs text-slate-400">{t("myCharacters.register.title")}</div>
        <CharacterSearchPicker
          characters={characters}
          onSelect={onSelect}
          placeholder={t("myCharacters.register.searchPlaceholder")}
        />
      </div>
      {error ? (
        <p className="text-xs text-rose-400" role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}
