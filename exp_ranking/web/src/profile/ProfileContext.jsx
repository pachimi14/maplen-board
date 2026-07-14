import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  addPin,
  clearGoalIn,
  createProfileStorage,
  interpretStorageEvent,
  readProfile,
  removePin,
  setGoalIn,
  setPrimaryPin,
  writeProfile,
} from "./profile.js";

/**
 * ProfileContext (T4a): React binding layer (c) over the pure profile store
 * (profile.js). Not wired into the app yet — see docs/IMPL_PLAN_T4A.md §13.
 *
 * ProfileProvider holds the single in-memory source of truth for the
 * profile (pins + goals). All mutations follow save-then-commit (§5):
 * compute the pure next profile, persist it, and only update React state
 * when persistence succeeded. A failed write never confirms locally and
 * never touches the previously-stored value.
 */

const ProfileContext = createContext(null);

function profilesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * @param {{ children: React.ReactNode, storage?: ReturnType<typeof createProfileStorage> }} props
 *   `storage` is an optional override (defaults to window.localStorage via
 *   createProfileStorage()); useful for future non-DOM testing, never used
 *   by the app itself in T4a.
 */
export function ProfileProvider({ children, storage: storageOverride }) {
  const storageRef = useRef(null);
  if (storageRef.current === null) {
    storageRef.current = storageOverride ?? createProfileStorage();
  }
  const storage = storageRef.current;

  const [state, setState] = useState(() => readProfile(storage));
  // Mirrors `state` synchronously so mutation handlers can read/write the
  // latest value without depending on React's setState batching/timing —
  // callers need a synchronous { ok, code, profile } result (§4).
  const stateRef = useRef(state);
  stateRef.current = state;

  // Cross-tab sync (§5 storage event contract). interpretStorageEvent is a
  // pure function; this effect only wires it to window + state and cleans
  // up the listener on unmount.
  useEffect(() => {
    function handleStorage(event) {
      const interpreted = interpretStorageEvent(event);
      if (!interpreted) {
        return;
      }
      const current = stateRef.current;
      if (current.status === interpreted.status && profilesEqual(current.profile, interpreted.profile)) {
        return;
      }
      stateRef.current = interpreted;
      setState(interpreted);
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // Shared save-then-commit runner used by every mutation below.
  const commit = useCallback(
    (mutate, successCodes) => {
      const current = stateRef.current;
      // Unsupported-version data is never auto-migrated or silently
      // overwritten by a mutation (§5 non-destructive contract).
      if (current.status === "unsupportedVersion") {
        return { ok: false, code: "unsupportedVersion", profile: current.profile };
      }
      const { profile: next, code } = mutate(current.profile);
      if (!successCodes.includes(code)) {
        return { ok: false, code, profile: current.profile };
      }
      const { ok } = writeProfile(storage, next);
      if (!ok) {
        // Persistence failed: state stays as-is, existing stored value is
        // untouched (writeProfile never deletes on failure).
        return { ok: false, code: "saveFailed", profile: current.profile };
      }
      const nextState = { profile: next, status: "ok" };
      stateRef.current = nextState;
      setState(nextState);
      return { ok: true, code, profile: next };
    },
    [storage]
  );

  const pin = useCallback((historyKey) => commit((profile) => addPin(profile, historyKey), ["added"]), [commit]);

  const unpin = useCallback(
    (historyKey) => commit((profile) => removePin(profile, historyKey), ["removed"]),
    [commit]
  );

  const setPrimary = useCallback(
    (historyKey) => commit((profile) => setPrimaryPin(profile, historyKey), ["set"]),
    [commit]
  );

  const setGoal = useCallback(
    (historyKey, goal) => commit((profile) => setGoalIn(profile, historyKey, goal), ["set"]),
    [commit]
  );

  const clearGoal = useCallback(
    (historyKey) => commit((profile) => clearGoalIn(profile, historyKey), ["cleared"]),
    [commit]
  );

  const isPinned = useCallback(
    (historyKey) => state.profile.pinnedHistoryKeys.includes(historyKey),
    [state.profile]
  );

  const getGoal = useCallback((historyKey) => state.profile.goals[historyKey] ?? null, [state.profile]);

  const value = useMemo(
    () => ({
      profile: state.profile,
      status: state.status,
      primaryHistoryKey: state.profile.primaryHistoryKey,
      pinnedHistoryKeys: state.profile.pinnedHistoryKeys,
      isPinned,
      pin,
      unpin,
      setPrimary,
      getGoal,
      setGoal,
      clearGoal,
    }),
    [state, isPinned, pin, unpin, setPrimary, getGoal, setGoal, clearGoal]
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error("useProfile must be used within ProfileProvider");
  }
  return context;
}
