import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import CharacterGroupTools from "../CharacterGroupTools";
import { useBoard } from "../board/BoardContext";
import { navigateToList } from "../board/useHashRoute";
import { useProfile } from "../profile/ProfileContext";

/**
 * `#/group` — full-screen group comparison (T4b §22.4, decision C). Rendered
 * instead of (not alongside) the list/detail UI — no TOP3, filters, or
 * ranking table here. The active group itself is never part of the URL
 * (decision C): existing `activeGroupId`/localStorage stays the single
 * source of truth, unaffected by this route's existence.
 *
 * History for the active group's members is fetched by the board hook
 * itself (`useRankingBoard`'s `ensureHistories` effect keyed on
 * `activeGroup`, unconditional on route) — this view does not duplicate
 * that fetch (§22.5).
 */
export default function GroupCompareView() {
  const { t, characters, rankingPool, groupDetailProps } = useBoard();
  const { primaryHistoryKey } = useProfile();
  // Lets the user click through group-member chips to switch which
  // character the tools are anchored on (add/remove-from-group button,
  // "current" highlight) without leaving this route (mirrors the former
  // §21.3 in-list behavior).
  const [anchorId, setAnchorId] = useState(null);

  // §21.3's anchor-resolution rule, carried over unchanged: explicit
  // override -> primary my-character (profile) -> top of the ranking pool
  // -> first loaded character -> null (empty state rather than a crash on
  // an empty roster).
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

  return (
    <div className="space-y-4">
      <Button
        type="button"
        variant="outline"
        className="border-slate-700 bg-slate-950"
        onClick={() => navigateToList()}
      >
        <ArrowLeft size={16} className="mr-2" />
        {t("route.backToList")}
      </Button>

      {anchorCharacter ? (
        <CharacterGroupTools
          character={anchorCharacter}
          characters={characters}
          groups={groupDetailProps.groups}
          activeGroup={groupDetailProps.activeGroup}
          activeGroupId={groupDetailProps.activeGroupId}
          setActiveGroupId={groupDetailProps.setActiveGroupId}
          createGroup={groupDetailProps.createGroup}
          deleteGroup={groupDetailProps.deleteGroup}
          renameGroup={groupDetailProps.renameGroup}
          addMember={groupDetailProps.addMember}
          removeMember={groupDetailProps.removeMember}
          isInActiveGroup={groupDetailProps.isInActiveGroup}
          toggleMemberInActiveGroup={groupDetailProps.toggleMemberInActiveGroup}
          addFavoritesToGroup={groupDetailProps.addFavoritesToGroup}
          favorites={groupDetailProps.favorites}
          maxMembers={groupDetailProps.maxGroupMembers}
          onSelectCharacter={setAnchorId}
          variant="full"
        />
      ) : (
        <p className="text-sm text-slate-500 bg-slate-900 border border-slate-800 rounded-2xl px-4 py-6 text-center">
          {t("group.noCharacters")}
        </p>
      )}
    </div>
  );
}
