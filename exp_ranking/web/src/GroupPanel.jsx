import React from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import CharacterGroupTools from "./CharacterGroupTools";
import { useTranslation } from "./i18n/I18nContext";

export default function GroupPanel({
  character,
  characters,
  mode = "compact",
  onExpand,
  onCollapse,
  onSelectCharacter,
  groups,
  activeGroup,
  activeGroupId,
  setActiveGroupId,
  createGroup,
  deleteGroup,
  renameGroup,
  addMember,
  removeMember,
  isInActiveGroup,
  toggleMemberInActiveGroup,
  maxGroupMembers,
}) {
  const { t } = useTranslation();
  const isExpanded = mode === "expanded";

  if (!character) {
    return null;
  }

  return (
    <div className="space-y-4">
      {isExpanded && onCollapse ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-slate-700 bg-slate-950 text-xs"
            onClick={onCollapse}
          >
            <ChevronUp size={14} className="mr-1" />
            {t("group.collapseGroup")}
          </Button>
        </div>
      ) : null}

      <CharacterGroupTools
        character={character}
        characters={characters}
        groups={groups}
        activeGroup={activeGroup}
        activeGroupId={activeGroupId}
        setActiveGroupId={setActiveGroupId}
        createGroup={createGroup}
        deleteGroup={deleteGroup}
        renameGroup={renameGroup}
        addMember={addMember}
        removeMember={removeMember}
        isInActiveGroup={isInActiveGroup}
        toggleMemberInActiveGroup={toggleMemberInActiveGroup}
        maxMembers={maxGroupMembers}
        onSelectCharacter={onSelectCharacter}
        variant={isExpanded ? "full" : "compact"}
      />

      {!isExpanded && onExpand ? (
        <Button
          type="button"
          variant="outline"
          className="w-full border-slate-700 bg-slate-950 hover:bg-slate-800"
          onClick={onExpand}
        >
          <ChevronDown size={16} className="mr-2" />
          {t("group.expandGroup")}
        </Button>
      ) : null}
    </div>
  );
}
