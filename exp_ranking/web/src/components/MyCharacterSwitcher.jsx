import { useTranslation } from "../i18n/I18nContext";

/**
 * Chip switcher for pinned characters (T4b §7/§20-8: "1 displayed + switch
 * UI", never 3 cards stacked). Switching only changes the summary's local
 * `displayedHistoryKey` — it never calls `setPrimary` (that is a distinct,
 * explicit action available from `MyCharacterPinButton`). Renders nothing
 * when there is nothing to switch between (0 or 1 pin).
 */
export default function MyCharacterSwitcher({
  pinnedHistoryKeys,
  primaryHistoryKey,
  displayedHistoryKey,
  labelForKey,
  onSelect,
}) {
  const { t } = useTranslation();

  if (!Array.isArray(pinnedHistoryKeys) || pinnedHistoryKeys.length <= 1) {
    return null;
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {pinnedHistoryKeys.map((key) => {
        const isActive = key === displayedHistoryKey;
        const isPrimary = key === primaryHistoryKey;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            aria-pressed={isActive}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition whitespace-nowrap ${
              isActive
                ? "border-cyan-500 bg-cyan-950/60 text-cyan-200"
                : "border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {labelForKey(key)}
            {isPrimary ? (
              <span className="ml-1.5 rounded-full bg-cyan-500/20 px-1.5 text-[10px] font-bold text-cyan-200">
                {t("myCharacters.pin.primaryBadge")}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
