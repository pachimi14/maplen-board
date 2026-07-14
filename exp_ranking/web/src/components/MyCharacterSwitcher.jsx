import { useTranslation } from "../i18n/I18nContext";
import { MAX_PINS } from "../profile/profile";

/**
 * Chip switcher for pinned characters (T4b §7/§20-8: "1 displayed + switch
 * UI", never 3 cards stacked). Switching only changes the summary's local
 * `displayedHistoryKey` — it never calls `setPrimary` (that is a distinct,
 * explicit action available from `MyCharacterPinButton`).
 *
 * §22.13 #3: also renders a "+ add sub character" affordance whenever
 * there's at least one pin and room for more (< MAX_PINS) — even with
 * only 1 pin (no chips to switch between yet), so there's still a way to
 * add a 2nd/3rd character. Renders nothing at all when there are no pins
 * (that state is handled by `MyCharacterEmptyCta` instead).
 */
export default function MyCharacterSwitcher({
  pinnedHistoryKeys,
  primaryHistoryKey,
  displayedHistoryKey,
  labelForKey,
  onSelect,
  onAddSub,
}) {
  const { t } = useTranslation();

  const pinned = Array.isArray(pinnedHistoryKeys) ? pinnedHistoryKeys : [];
  if (pinned.length === 0) {
    return null;
  }

  const canAddSub = pinned.length < MAX_PINS;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {pinned.length > 1
        ? pinned.map((key) => {
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
                <span
                  className={`ml-1.5 rounded-full px-1.5 text-[10px] font-bold ${
                    isPrimary ? "bg-cyan-500/20 text-cyan-200" : "bg-slate-700/50 text-slate-300"
                  }`}
                >
                  {t(isPrimary ? "myCharacters.pin.primaryBadge" : "myCharacters.pin.subBadge")}
                </span>
              </button>
            );
          })
        : null}
      {canAddSub ? (
        <button
          type="button"
          onClick={onAddSub}
          className="shrink-0 rounded-full border border-dashed border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300 whitespace-nowrap transition hover:bg-slate-800"
        >
          {t("myCharacters.switcher.addSub")}
        </button>
      ) : null}
    </div>
  );
}
