import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import CharacterSearchPicker from "../CharacterSearchPicker";
import { useProfile } from "../profile/ProfileContext";
import { errorMessageKeyForCode, resolveDisplayedHistoryKey, shouldStartHistoryFetch } from "./myCharacterUtils";
import MyCharacterEmptyCta from "./MyCharacterEmptyCta";
import MyCharacterSwitcher from "./MyCharacterSwitcher";
import MyCharacterCard from "./MyCharacterCard";

/**
 * §22.13 #3: the "add a sub character" search panel shown in place of the
 * card while `registerMode` is on. Same CharacterSearchPicker +
 * useProfile().pin reuse as MyCharacterEmptyCta's zero-pin search, plus a
 * cancel action back to the normal card.
 */
function RegisterSubPanel({ characters, onSelect, onCancel, error, t }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-5 sm:p-6 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">{t("myCharacters.register.title")}</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 border-slate-700 bg-slate-950 text-xs"
          onClick={onCancel}
        >
          {t("myCharacters.register.cancel")}
        </Button>
      </div>
      <CharacterSearchPicker
        characters={characters}
        onSelect={onSelect}
        placeholder={t("myCharacters.register.searchPlaceholder")}
      />
      {error ? (
        <p className="text-xs text-rose-400" role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Home-screen self-summary (T4b). Consumes T3 (via MyCharacterCard) and T4a
 * (`useProfile`) and renders them — it does not recompute stats or persist
 * anything itself. Placed at the top of RankingListView's fragment, above
 * the TOP3 highlights (§1).
 *
 * Owns exactly one piece of navigational state (besides the fetch-status
 * map below): `displayedHistoryKey` — the character currently shown,
 * independent from `primaryHistoryKey` (§7/§20-3). See
 * resolveDisplayedHistoryKey for the switch-back rule. There is no "show
 * more" toggle anymore (§22.1/§22.2): MyCharacterCard always shows
 * everything, fetching its history shard as soon as it is displayed.
 *
 * §22.13 #3: `registerMode` (search-and-pin a sub character in place of the
 * card) is the only other piece of local UI state — pinning itself is
 * `useProfile().pin`, never reimplemented here.
 */
export default function MyCharacterSummary({ characters, meta, expTable, gainRankMaps, ensureHistories, t }) {
  const { pin, pinnedHistoryKeys, primaryHistoryKey } = useProfile();

  const [displayedHistoryKey, setDisplayedHistoryKey] = useState(() => primaryHistoryKey);
  const [registerMode, setRegisterMode] = useState(false);
  const [registerError, setRegisterError] = useState(null);
  // §6/§20-4: fetch status per historyKey ("loading" | "failed"; absence =
  // idle/not-yet-requested). Keyed by historyKey (not a single flat flag) so
  // a late-arriving result for a key the user has since switched away from
  // can never corrupt the currently-displayed key's status.
  //
  // LULU-028 (P0 fix): this state is for *rendering* only. It must never be
  // a dependency of the fetch-triggering effect below — doing so previously
  // caused every "loading" setState to immediately re-run that effect, whose
  // cleanup canceled the very request it had just started, permanently
  // stranding the UI on "loading" even though the shard fetch itself
  // succeeded (real characters, not the already-loaded rank-1 default,
  // never recovered). `retryTick` is the one explicit, user-driven signal
  // that re-arms the effect after a failure.
  const [historyFetch, setHistoryFetch] = useState({});
  const [retryTick, setRetryTick] = useState(0);

  // §7/§20-3: only recompute when the current selection is no longer
  // pinned (covers "first pin appears" via the null case, and "displayed
  // character got unpinned"). A still-pinned displayedHistoryKey is left
  // untouched even if `primaryHistoryKey` itself changes elsewhere (e.g. a
  // cross-tab primary change) — no unnecessary state update either.
  useEffect(() => {
    setDisplayedHistoryKey((current) => {
      if (current != null && pinnedHistoryKeys.includes(current)) {
        return current;
      }
      return resolveDisplayedHistoryKey(current, pinnedHistoryKeys, primaryHistoryKey);
    });
  }, [pinnedHistoryKeys, primaryHistoryKey]);

  const charactersByKey = useMemo(() => {
    const map = new Map();
    for (const character of characters) {
      if (character.historyKey) {
        map.set(character.historyKey, character);
      }
    }
    return map;
  }, [characters]);

  // Mirrors the latest `characters` so the fetch effect below can check the
  // outcome after `ensureHistories` resolves without depending on a stale
  // closure (its own `characters` dependency already covers the common
  // case, but board state can in principle change through other effects
  // in between the call and its resolution).
  const charactersRef = useRef(characters);
  useEffect(() => {
    charactersRef.current = characters;
  }, [characters]);

  // §6/§20-4/§22.2: fetch only the *displayed* character's history shard —
  // as soon as it is displayed (no "show more"/expand step gates this
  // anymore, per §22.2) — only when it isn't already loaded (board's
  // `characters` state — via ensureHistories's own cache — is the single
  // source of truth; no second cache is kept here) and only when a fetch
  // for this key isn't already in flight. Switching to a different
  // character while A is still loading starts a request keyed under B; A's
  // late result can only ever update `historyFetch[A]`, never B's display
  // (§20-4).
  //
  // LULU-028 (P0 fix): deps are deliberately just the *user-driven*
  // triggers — switching character, `ensureHistories` itself, and the
  // explicit retry tick. `characters` and `historyFetch` must NOT be deps
  // here: both change as a *side effect* of this very effect running (the
  // fetch resolving updates `characters`; starting a fetch updates
  // `historyFetch`), so including them reran this effect on its own output,
  // whose cleanup canceled the in-flight request before it could resolve —
  // permanently stuck "loading" for any character not already preloaded by
  // some other part of the board. `charactersRef` (kept fresh by the effect
  // above) is read instead, both for the "already loaded" pre-check and for
  // verifying the outcome once `ensureHistories` resolves.
  useEffect(() => {
    if (!displayedHistoryKey || typeof ensureHistories !== "function") {
      return undefined;
    }
    const keyAtStart = displayedHistoryKey;
    const target = charactersRef.current.find((c) => c.historyKey === keyAtStart);
    if (!target) {
      return undefined;
    }
    // "loading"/"failed" only clear via this effect's own resolution or the
    // explicit retry action (§6: "再試行は現在表示中キャラのみ") — read once,
    // from the render that (re)created this effect; never a reason on its
    // own to re-run it (see the dependency-array note above).
    if (
      !shouldStartHistoryFetch({
        historyKey: keyAtStart,
        history: target.history,
        status: historyFetch[keyAtStart],
      })
    ) {
      return undefined;
    }

    let cancelled = false;
    setHistoryFetch((current) => ({ ...current, [keyAtStart]: "loading" }));

    Promise.resolve(ensureHistories([target])).then(() => {
      if (cancelled) {
        return;
      }
      const loaded = charactersRef.current.find((c) => c.historyKey === keyAtStart);
      setHistoryFetch((current) => {
        const next = { ...current };
        if (Array.isArray(loaded?.history)) {
          delete next[keyAtStart];
        } else {
          next[keyAtStart] = "failed";
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedHistoryKey, ensureHistories, retryTick]);

  const labelForKey = (key) => charactersByKey.get(key)?.name ?? key;

  // §22.13 #3: shared by the zero-pin empty-CTA search and the ≥1-pin
  // "add sub" registerMode search — both are just useProfile().pin, never
  // reimplemented. `id` is the CharacterSearchPicker/ranking-row id (not
  // historyKey); a row without a historyKey can't be pinned at all.
  // "alreadyPinned" is treated the same as success (§22.13: "成功/既存で
  // registerMode を閉じる") — it isn't a real error, just a no-op.
  const handleRegisterSelect = (id) => {
    const target = characters.find((character) => character.id === id);
    if (!target?.historyKey) {
      setRegisterError("myCharacters.error.invalidKey");
      return;
    }
    const result = pin(target.historyKey);
    if (result.ok || result.code === "alreadyPinned") {
      setRegisterError(null);
      setRegisterMode(false);
      return;
    }
    setRegisterError(errorMessageKeyForCode(result.code) ?? "myCharacters.error.saveFailed");
  };

  if (!displayedHistoryKey) {
    return <MyCharacterEmptyCta characters={characters} onSelect={handleRegisterSelect} error={registerError} />;
  }

  const displayedCharacter = charactersByKey.get(displayedHistoryKey);
  // Retry re-fetches only the currently displayed character (§6: "再試行は
  // 現在表示中キャラのみ"): clear its "failed" mark and bump `retryTick` —
  // the one dependency that intentionally re-arms the fetch effect above on
  // an explicit user action (not automatically from the effect's own state
  // updates; see the dependency-array note there).
  const retryHistory = () => {
    setHistoryFetch((current) => {
      if (!(displayedHistoryKey in current)) {
        return current;
      }
      const next = { ...current };
      delete next[displayedHistoryKey];
      return next;
    });
    setRetryTick((current) => current + 1);
  };

  return (
    <div className="space-y-3">
      <MyCharacterSwitcher
        pinnedHistoryKeys={pinnedHistoryKeys}
        primaryHistoryKey={primaryHistoryKey}
        displayedHistoryKey={displayedHistoryKey}
        labelForKey={labelForKey}
        onSelect={setDisplayedHistoryKey}
        onAddSub={() => {
          setRegisterError(null);
          setRegisterMode(true);
        }}
      />
      {registerMode ? (
        <RegisterSubPanel
          characters={characters}
          onSelect={handleRegisterSelect}
          onCancel={() => {
            setRegisterMode(false);
            setRegisterError(null);
          }}
          error={registerError}
          t={t}
        />
      ) : (
        <MyCharacterCard
          character={displayedCharacter}
          historyKey={displayedHistoryKey}
          allCharacters={characters}
          meta={meta}
          expTable={expTable}
          gainRankMaps={gainRankMaps}
          historyStatus={historyFetch[displayedHistoryKey] ?? "idle"}
          onRetryHistory={retryHistory}
          t={t}
        />
      )}
    </div>
  );
}
