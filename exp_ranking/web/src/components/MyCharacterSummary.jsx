import { useEffect, useMemo, useState } from "react";
import { useProfile } from "../profile/ProfileContext";
import { resolveDisplayedHistoryKey } from "./myCharacterUtils";
import MyCharacterEmptyCta from "./MyCharacterEmptyCta";
import MyCharacterSwitcher from "./MyCharacterSwitcher";
import MyCharacterCard from "./MyCharacterCard";

/**
 * Home-screen self-summary (T4b). Consumes T3 (via MyCharacterCard) and T4a
 * (`useProfile`) and renders them — it does not recompute stats or persist
 * anything itself. Placed at the top of RankingListView's fragment, above
 * the TOP3 highlights (§1).
 *
 * Owns exactly one piece of state beyond the "show more" toggle:
 * `displayedHistoryKey` — the character currently shown, independent from
 * `primaryHistoryKey` (§7/§20-3). See resolveDisplayedHistoryKey for the
 * switch-back rule.
 */
export default function MyCharacterSummary({ characters, meta, expTable, onFocusSearch, t }) {
  const { pinnedHistoryKeys, primaryHistoryKey } = useProfile();

  const [displayedHistoryKey, setDisplayedHistoryKey] = useState(() => primaryHistoryKey);
  const [expanded, setExpanded] = useState(false);

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

  const labelForKey = (key) => charactersByKey.get(key)?.name ?? key;

  if (!displayedHistoryKey) {
    return <MyCharacterEmptyCta onFocusSearch={onFocusSearch} />;
  }

  const displayedCharacter = charactersByKey.get(displayedHistoryKey);

  return (
    <div className="space-y-3">
      <MyCharacterSwitcher
        pinnedHistoryKeys={pinnedHistoryKeys}
        primaryHistoryKey={primaryHistoryKey}
        displayedHistoryKey={displayedHistoryKey}
        labelForKey={labelForKey}
        onSelect={setDisplayedHistoryKey}
      />
      <MyCharacterCard
        character={displayedCharacter}
        historyKey={displayedHistoryKey}
        allCharacters={characters}
        meta={meta}
        expTable={expTable}
        expanded={expanded}
        onToggleExpanded={() => setExpanded((current) => !current)}
        t={t}
      />
    </div>
  );
}
