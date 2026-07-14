import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProfile } from "../profile/ProfileContext";
import { errorMessageKeyForCode } from "./myCharacterUtils";
import { LEVEL_CAP, MIN_PLANNER_LEVEL, defaultTargetDateIso } from "../rankingUtils";

function defaultTargetLevel(character) {
  const next = Math.max((character?.level ?? 0) + 1, MIN_PLANNER_LEVEL);
  return Math.min(LEVEL_CAP, next);
}

/**
 * Small in-card modal for setting/editing/deleting a character's goal
 * (T4b §9/§20-9). Save/cancel/delete are kept explicitly separate; the
 * *only* validation path is T4a's `setGoal` (`normalizeGoal`, Lv225-275 +
 * a real calendar date, matching rankingUtils' own MIN_PLANNER_LEVEL/
 * LEVEL_CAP per §20-9) — this component never re-implements that range
 * check. Rendered as an in-flow absolute overlay confined to the card
 * (`position: fixed` is never used, so it can't escape the viewport on
 * mobile), not a portal.
 */
export default function GoalModal({ open, historyKey, character, onClose, triggerRef, t }) {
  const { getGoal, setGoal, clearGoal } = useProfile();
  const firstFieldRef = useRef(null);
  const savedGoal = open ? getGoal(historyKey) : null;

  const [levelInput, setLevelInput] = useState("");
  const [dateInput, setDateInput] = useState("");
  const [error, setError] = useState(null);

  // Seed from the saved goal only when the modal (re)opens — not on every
  // render, so an unrelated profile change elsewhere never clobbers
  // in-progress edits (§9: initial value only, not a live sync).
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const goal = getGoal(historyKey);
    setLevelInput(String(goal?.targetLevel ?? defaultTargetLevel(character)));
    setDateInput(goal?.targetDateIso ?? defaultTargetDateIso(30));
    setError(null);
    const frame = window.requestAnimationFrame(() => {
      firstFieldRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, historyKey]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeAndReturnFocus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) {
    return null;
  }

  function closeAndReturnFocus() {
    onClose();
    triggerRef?.current?.focus();
  }

  function handleSave() {
    const targetLevel = Number(levelInput);
    const result = setGoal(historyKey, { targetLevel, targetDateIso: dateInput });
    if (result.ok) {
      closeAndReturnFocus();
      return;
    }
    setError(errorMessageKeyForCode(result.code) ?? "myCharacters.error.invalidGoal");
  }

  function handleDelete() {
    const result = clearGoal(historyKey);
    if (result.ok) {
      closeAndReturnFocus();
      return;
    }
    setError(errorMessageKeyForCode(result.code) ?? "myCharacters.error.saveFailed");
  }

  const titleId = `goal-modal-title-${historyKey}`;

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-slate-950/80 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          closeAndReturnFocus();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm max-h-full overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-4"
      >
        <h3 id={titleId} className="text-base font-bold">
          {t("myCharacters.goal.title")}
        </h3>

        <div className="space-y-3">
          <label className="block text-xs text-slate-400 space-y-1">
            <span className="block">{t("myCharacters.goal.level")}</span>
            <Input
              ref={firstFieldRef}
              type="number"
              min={MIN_PLANNER_LEVEL}
              max={LEVEL_CAP}
              value={levelInput}
              onChange={(event) => setLevelInput(event.target.value)}
              className="w-full bg-slate-950 border-slate-700 text-slate-100"
            />
          </label>
          <label className="block text-xs text-slate-400 space-y-1">
            <span className="block">{t("myCharacters.goal.date")}</span>
            <Input
              type="date"
              value={dateInput}
              onChange={(event) => setDateInput(event.target.value)}
              className="w-full bg-slate-950 border-slate-700 text-slate-100"
            />
          </label>
        </div>

        {error ? (
          <p className="text-xs text-rose-400" role="alert">
            {t(error)}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            className="border-slate-700 bg-slate-950 text-rose-300"
            disabled={!savedGoal}
            onClick={handleDelete}
          >
            {t("myCharacters.goal.delete")}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="border-slate-700 bg-slate-950" onClick={closeAndReturnFocus}>
              {t("myCharacters.goal.cancel")}
            </Button>
            <Button type="button" onClick={handleSave}>
              {t("myCharacters.goal.save")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
