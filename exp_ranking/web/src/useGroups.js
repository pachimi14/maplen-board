import { useCallback, useState } from "react";
import {
  createGroupId,
  defaultGroupName,
  groupMemberKey,
  loadGroupsState,
  MAX_GROUP_MEMBERS,
  saveGroupsState,
} from "./groups";

function persist(groups, activeGroupId) {
  saveGroupsState(groups, activeGroupId);
}

export function useGroups() {
  const [state, setState] = useState(() => loadGroupsState());

  const activeGroup =
    state.groups.find((group) => group.id === state.activeGroupId) ?? state.groups[0] ?? null;

  const setActiveGroupId = useCallback((groupId) => {
    setState((previous) => {
      const next = { ...previous, activeGroupId: groupId };
      persist(next.groups, next.activeGroupId);
      return next;
    });
  }, []);

  const createGroup = useCallback(() => {
    setState((previous) => {
      const group = {
        id: createGroupId(),
        name: defaultGroupName(previous.groups.length + 1),
        members: [],
      };
      const groups = [...previous.groups, group];
      const next = { groups, activeGroupId: group.id };
      persist(groups, group.id);
      return next;
    });
  }, []);

  const deleteGroup = useCallback((groupId) => {
    setState((previous) => {
      const groups = previous.groups.filter((group) => group.id !== groupId);
      const activeGroupId =
        previous.activeGroupId === groupId ? groups[0]?.id || "" : previous.activeGroupId;
      const next = { groups, activeGroupId };
      persist(groups, activeGroupId);
      return next;
    });
  }, []);

  const renameGroup = useCallback((groupId, name) => {
    const trimmed = String(name || "").trim();
    if (!trimmed) {
      return;
    }
    setState((previous) => {
      const groups = previous.groups.map((group) =>
        group.id === groupId ? { ...group, name: trimmed } : group,
      );
      const next = { ...previous, groups };
      persist(groups, next.activeGroupId);
      return next;
    });
  }, []);

  const addMember = useCallback((groupId, character) => {
    const key = groupMemberKey(character);
    if (!key) {
      return false;
    }
    let added = false;
    setState((previous) => {
      const groups = previous.groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }
        if (group.members.includes(key) || group.members.length >= MAX_GROUP_MEMBERS) {
          return group;
        }
        added = true;
        return { ...group, members: [...group.members, key] };
      });
      const next = { ...previous, groups };
      persist(groups, next.activeGroupId);
      return next;
    });
    return added;
  }, []);

  const removeMember = useCallback((groupId, memberKey) => {
    setState((previous) => {
      const groups = previous.groups.map((group) =>
        group.id === groupId
          ? { ...group, members: group.members.filter((name) => name !== memberKey) }
          : group,
      );
      const next = { ...previous, groups };
      persist(groups, next.activeGroupId);
      return next;
    });
  }, []);

  const isInActiveGroup = useCallback(
    (character) => {
      if (!activeGroup) {
        return false;
      }
      const key = groupMemberKey(character);
      return Boolean(key && activeGroup.members.includes(key));
    },
    [activeGroup],
  );

  const toggleMemberInActiveGroup = useCallback((character) => {
    const key = groupMemberKey(character);
    if (!key) {
      return false;
    }
    let changed = false;
    setState((previous) => {
      let groups = [...previous.groups];
      let activeGroupId = previous.activeGroupId;
      let groupIndex = groups.findIndex((group) => group.id === activeGroupId);
      if (groupIndex < 0) {
        const created = {
          id: createGroupId(),
          name: defaultGroupName(groups.length + 1),
          members: [key],
        };
        groups = [...groups, created];
        activeGroupId = created.id;
        changed = true;
      } else {
        const group = groups[groupIndex];
        if (group.members.includes(key)) {
          groups[groupIndex] = {
            ...group,
            members: group.members.filter((name) => name !== key),
          };
          changed = true;
        } else if (group.members.length < MAX_GROUP_MEMBERS) {
          groups[groupIndex] = { ...group, members: [...group.members, key] };
          changed = true;
        }
      }
      const next = { groups, activeGroupId };
      persist(groups, activeGroupId);
      return next;
    });
    return changed;
  }, []);

  return {
    groups: state.groups,
    activeGroup,
    activeGroupId: state.activeGroupId,
    setActiveGroupId,
    createGroup,
    deleteGroup,
    renameGroup,
    addMember,
    removeMember,
    isInActiveGroup,
    toggleMemberInActiveGroup,
    maxMembers: MAX_GROUP_MEMBERS,
  };
}
