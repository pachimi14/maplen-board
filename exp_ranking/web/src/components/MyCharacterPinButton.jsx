import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "../i18n/I18nContext";
import { useProfile } from "../profile/ProfileContext";
import { MAX_PINS } from "../profile/profile";
import { errorMessageKeyForCode } from "./myCharacterUtils";

/**
 * Pin/unpin/set-primary controls for a single character (T4b §4/§20-5).
 * Consumes `useProfile()` directly so `CharacterDetail` never needs to know
 * about the profile store — callers just render `<MyCharacterPinButton
 * character={...} />` as the `pinControls` node. Deliberately visually
 * distinct from the existing favorite ★ (separate labels/pill styling, not
 * a star), per §4.
 */
export default function MyCharacterPinButton({ character, className = "" }) {
  const { t } = useTranslation();
  const { isPinned, pin, unpin, setPrimary, primaryHistoryKey, pinnedHistoryKeys } = useProfile();
  const historyKey = character?.historyKey || null;
  const [error, setError] = useState(null);

  // A failed action's inline message must not leak onto a different
  // character (§8: "別操作のエラーを無関係な場所に出さない").
  useEffect(() => {
    setError(null);
  }, [historyKey]);

  const pinned = historyKey ? isPinned(historyKey) : false;
  const isPrimary = Boolean(historyKey) && primaryHistoryKey === historyKey;
  const atLimit = pinnedHistoryKeys.length >= MAX_PINS;

  const applyResult = (result) => {
    if (result.ok) {
      setError(null);
      return;
    }
    // No-op codes (notPinned/alreadyPinned/etc.) have no dedicated message;
    // errorMessageKeyForCode returns null for those, so nothing is shown.
    setError(errorMessageKeyForCode(result.code));
  };

  const handlePin = () => {
    if (!historyKey) {
      return;
    }
    applyResult(pin(historyKey));
  };

  const handleUnpin = () => {
    if (!historyKey) {
      return;
    }
    applyResult(unpin(historyKey));
  };

  const handleSetPrimary = () => {
    if (!historyKey) {
      return;
    }
    applyResult(setPrimary(historyKey));
  };

  const addDisabled = !historyKey || (!pinned && atLimit);
  const disabledReasonKey = !historyKey
    ? "myCharacters.pin.disabled.noHistoryKey"
    : !pinned && atLimit
      ? "myCharacters.pin.disabled.limit"
      : null;

  return (
    <div className={`flex flex-col items-start gap-1 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        {pinned ? (
          <>
            <span className="profile-pin-status inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              {t("myCharacters.pin.registered")}
              {isPrimary ? (
                <span className="profile-primary-badge rounded-full bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-700">
                  {t("myCharacters.pin.primaryBadge")}
                </span>
              ) : (
                <span className="rounded-full bg-slate-700/50 px-1.5 text-[10px] font-bold text-slate-300">
                  {t("myCharacters.pin.subBadge")}
                </span>
              )}
            </span>
            {!isPrimary ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 border-slate-700 bg-slate-950 text-xs"
                onClick={handleSetPrimary}
              >
                {t("myCharacters.pin.setPrimary")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 border-slate-700 bg-slate-950 text-xs"
              onClick={handleUnpin}
            >
              {t("myCharacters.pin.remove")}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 border-slate-700 bg-slate-950 text-xs"
            disabled={addDisabled}
            onClick={handlePin}
          >
            {t("myCharacters.pin.add")}
          </Button>
        )}
      </div>

      {!pinned && disabledReasonKey ? (
        <p className="text-xs text-slate-500">{t(disabledReasonKey)}</p>
      ) : null}

      {error ? (
        <p className="text-xs text-rose-400" role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}
