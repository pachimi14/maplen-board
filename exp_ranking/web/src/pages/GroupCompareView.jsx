import { useMemo, useState } from "react";
import GroupPanel from "../GroupPanel";
import { useBoard } from "../board/BoardContext";
import { navigateToList } from "../board/useHashRoute";
import { useProfile } from "../profile/ProfileContext";

/**
 * `#/group` — full-screen group comparison (T4b §22.4, revised). This is a
 * *display-location* change only: the existing `GroupPanel`/
 * `CharacterGroupTools` (and everything underneath — computation, data,
 * localStorage, operations) are unchanged and rendered as-is, just moved
 * to a dedicated full-screen route instead of the list's inline panel
 * (§21). No comparison table, no new group UI/flags, no new fallback
 * logic here.
 *
 * The active group itself is never part of the URL (decision C): existing
 * `activeGroupId`/localStorage stays the single source of truth,
 * unaffected by this route's existence.
 *
 * History for the active group's members is fetched by the board hook
 * itself (`useRankingBoard`'s `ensureHistories` effect keyed on
 * `activeGroup`, unconditional on route) — this view does not add any
 * fetch logic of its own.
 */
export default function GroupCompareView() {
  const { characters, rankingPool, groupDetailProps } = useBoard();
  const { primaryHistoryKey } = useProfile();
  // Lets the user click through group-member chips to switch which
  // character the panel is anchored on (add/remove-from-group button,
  // "current" highlight) without leaving this route — the exact §21.3
  // (LULU-029) behavior, just relocated from RankingListView.
  const [anchorId, setAnchorId] = useState(null);

  // §21.3/LULU-029's anchor-resolution rule, moved here unchanged: explicit
  // override -> primary my-character (profile) -> top of the ranking pool
  // -> first loaded character -> null (empty state rather than a crash on
  // an empty roster). No new fallback is added.
  const anchorCharacter = useMemo(() => {
    if (anchorId != null) {
      const overridden = characters.find((character) => character.id === anchorId);
      if (overridden) {
        return overridden;
      }
    }
    if (primaryHistoryKey) {
      const primary = characters.find((character) => character.historyKey === primaryHistoryKey);
      if (primary) {
        return primary;
      }
    }
    return rankingPool[0] ?? characters[0] ?? null;
  }, [anchorId, primaryHistoryKey, characters, rankingPool]);

  // Same GroupPanel the list used to render inline (§21) — unchanged
  // component, unchanged props — just full-screen here instead. `onCollapse`
  // is the one, unambiguous way back to the list (query preserved by
  // navigateToList's base.query merge), reusing GroupPanel's own existing
  // collapse control rather than adding a second/new back button.
  return (
    <GroupPanel
      character={anchorCharacter}
      characters={characters}
      mode="expanded"
      onCollapse={() => navigateToList()}
      onSelectCharacter={setAnchorId}
      {...groupDetailProps}
    />
  );
}
