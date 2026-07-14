import { describe, expect, it } from "vitest";
import {
  PROFILE_KEY,
  PROFILE_VERSION,
  MAX_PINS,
  defaultProfile,
  normalizeProfile,
  normalizeGoal,
  createProfileStorage,
  readProfile,
  writeProfile,
  interpretStorageEvent,
  addPin,
  removePin,
  setPrimaryPin,
  setGoalIn,
  clearGoalIn,
} from "./profile.js";

// ---------------------------------------------------------------------------
// In-memory backend fixtures (no real localStorage / no jsdom dependency).
// ---------------------------------------------------------------------------

function makeMemoryBackend(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
  };
}

function makeThrowingBackend({ onGetItem, onSetItem } = {}) {
  return {
    getItem(key) {
      if (onGetItem) {
        throw new Error("getItem boom");
      }
      return null;
    },
    setItem(key, value) {
      if (onSetItem) {
        throw new Error("setItem boom");
      }
    },
  };
}

const goodGoal = { targetLevel: 250, targetDateIso: "2026-09-01" };

// ---------------------------------------------------------------------------
// 1. normalizeProfile
// ---------------------------------------------------------------------------

describe("normalizeProfile", () => {
  it("dedupes pinnedHistoryKeys preserving first-occurrence order and caps at MAX_PINS", () => {
    const raw = {
      version: 1,
      primaryHistoryKey: "asset:X",
      pinnedHistoryKeys: ["asset:A", "asset:A", "asset:B", "asset:C", "asset:D", ""],
      goals: {},
    };
    const result = normalizeProfile(raw);
    expect(result.pinnedHistoryKeys).toEqual(["asset:A", "asset:B", "asset:C"]);
    expect(result.pinnedHistoryKeys.length).toBeLessThanOrEqual(MAX_PINS);
  });

  it("corrects primaryHistoryKey to the first pinned key when it is not among pinned keys", () => {
    const raw = {
      version: 1,
      primaryHistoryKey: "asset:X",
      pinnedHistoryKeys: ["asset:A", "asset:B"],
      goals: {},
    };
    const result = normalizeProfile(raw);
    expect(result.primaryHistoryKey).toBe("asset:A");
  });

  it("keeps a valid primaryHistoryKey that is among pinned keys", () => {
    const raw = {
      version: 1,
      primaryHistoryKey: "asset:B",
      pinnedHistoryKeys: ["asset:A", "asset:B"],
      goals: {},
    };
    expect(normalizeProfile(raw).primaryHistoryKey).toBe("asset:B");
  });

  it("sets primaryHistoryKey to null when there are no pinned keys", () => {
    const raw = { version: 1, primaryHistoryKey: "asset:A", pinnedHistoryKeys: [], goals: {} };
    expect(normalizeProfile(raw).primaryHistoryKey).toBeNull();
  });

  it("drops invalid goals but keeps normal ones (example from §3)", () => {
    const raw = {
      version: 1,
      primaryHistoryKey: "asset:X",
      pinnedHistoryKeys: ["asset:A", "asset:A", "asset:B", "asset:C", "asset:D", ""],
      goals: {
        "asset:A": { targetLevel: 250, targetDateIso: "2026-09-01" },
        "asset:B": { targetLevel: "bad", targetDateIso: "2026-09-01" },
      },
    };
    const result = normalizeProfile(raw);
    expect(result).toEqual({
      version: 1,
      primaryHistoryKey: "asset:A",
      pinnedHistoryKeys: ["asset:A", "asset:B", "asset:C"],
      goals: { "asset:A": { targetLevel: 250, targetDateIso: "2026-09-01" } },
    });
  });

  it("strips unknown top-level fields", () => {
    const raw = {
      version: 1,
      primaryHistoryKey: null,
      pinnedHistoryKeys: [],
      goals: {},
      extraField: "should be removed",
    };
    const result = normalizeProfile(raw);
    expect(result).not.toHaveProperty("extraField");
    expect(Object.keys(result).sort()).toEqual(
      ["goals", "pinnedHistoryKeys", "primaryHistoryKey", "version"].sort()
    );
  });

  it("returns defaultProfile for non-object input", () => {
    expect(normalizeProfile(null)).toEqual(defaultProfile());
    expect(normalizeProfile("nope")).toEqual(defaultProfile());
    expect(normalizeProfile([1, 2, 3])).toEqual(defaultProfile());
    expect(normalizeProfile(undefined)).toEqual(defaultProfile());
  });

  it("returns defaultProfile for unsupported version", () => {
    expect(normalizeProfile({ version: 2, pinnedHistoryKeys: ["asset:A"] })).toEqual(defaultProfile());
  });

  it("retains goals for historyKeys that are not currently pinned (goals are not auto-deleted)", () => {
    const raw = {
      version: 1,
      primaryHistoryKey: null,
      pinnedHistoryKeys: [],
      goals: { "asset:UNPINNED": goodGoal },
    };
    expect(normalizeProfile(raw).goals).toEqual({ "asset:UNPINNED": goodGoal });
  });
});

// ---------------------------------------------------------------------------
// 2. Goal normalization (§2.1)
// ---------------------------------------------------------------------------

describe("normalizeGoal (§2.1)", () => {
  it("accepts a valid goal and strips unknown fields", () => {
    expect(normalizeGoal({ targetLevel: 250, targetDateIso: "2026-09-01", extra: "x" })).toEqual({
      targetLevel: 250,
      targetDateIso: "2026-09-01",
    });
  });

  it("rejects non-integer targetLevel", () => {
    expect(normalizeGoal({ targetLevel: 250.5, targetDateIso: "2026-09-01" })).toBeNull();
    expect(normalizeGoal({ targetLevel: "250", targetDateIso: "2026-09-01" })).toBeNull();
    expect(normalizeGoal({ targetLevel: NaN, targetDateIso: "2026-09-01" })).toBeNull();
  });

  it("rejects targetLevel outside the valid range (224 / 276)", () => {
    expect(normalizeGoal({ targetLevel: 224, targetDateIso: "2026-09-01" })).toBeNull();
    expect(normalizeGoal({ targetLevel: 276, targetDateIso: "2026-09-01" })).toBeNull();
  });

  it("accepts the boundary levels 225 and 275", () => {
    expect(normalizeGoal({ targetLevel: 225, targetDateIso: "2026-09-01" })).toEqual({
      targetLevel: 225,
      targetDateIso: "2026-09-01",
    });
    expect(normalizeGoal({ targetLevel: 275, targetDateIso: "2026-09-01" })).toEqual({
      targetLevel: 275,
      targetDateIso: "2026-09-01",
    });
  });

  it("rejects malformed targetDateIso strings", () => {
    expect(normalizeGoal({ targetLevel: 250, targetDateIso: "2026/09/01" })).toBeNull();
    expect(normalizeGoal({ targetLevel: 250, targetDateIso: "2026-9-1" })).toBeNull();
    expect(normalizeGoal({ targetLevel: 250, targetDateIso: "not-a-date" })).toBeNull();
    expect(normalizeGoal({ targetLevel: 250, targetDateIso: 20260901 })).toBeNull();
  });

  it("rejects a targetDateIso that is not a real calendar day", () => {
    expect(normalizeGoal({ targetLevel: 250, targetDateIso: "2026-02-30" })).toBeNull();
    expect(normalizeGoal({ targetLevel: 250, targetDateIso: "2026-13-01" })).toBeNull();
    expect(normalizeGoal({ targetLevel: 250, targetDateIso: "2026-04-31" })).toBeNull();
  });

  it("does not save an incomplete goal (only one of the two fields present)", () => {
    expect(normalizeGoal({ targetLevel: 250 })).toBeNull();
    expect(normalizeGoal({ targetDateIso: "2026-09-01" })).toBeNull();
  });

  it("rejects non-object goal values", () => {
    expect(normalizeGoal(null)).toBeNull();
    expect(normalizeGoal("goal")).toBeNull();
    expect(normalizeGoal(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. readProfile status discrimination
// ---------------------------------------------------------------------------

describe("readProfile status discrimination", () => {
  it("returns status=missing when the key is absent", () => {
    const storage = createProfileStorage(makeMemoryBackend());
    const { profile, status } = readProfile(storage);
    expect(status).toBe("missing");
    expect(profile).toEqual(defaultProfile());
  });

  it("returns status=corrupt for unparsable JSON", () => {
    const backend = makeMemoryBackend({ [PROFILE_KEY]: "{not json" });
    const storage = createProfileStorage(backend);
    const { profile, status } = readProfile(storage);
    expect(status).toBe("corrupt");
    expect(profile).toEqual(defaultProfile());
  });

  it("returns status=corrupt for structurally invalid (non-object / missing version) payloads", () => {
    const backend = makeMemoryBackend({ [PROFILE_KEY]: JSON.stringify([1, 2, 3]) });
    const storage = createProfileStorage(backend);
    expect(readProfile(storage).status).toBe("corrupt");

    const backend2 = makeMemoryBackend({ [PROFILE_KEY]: JSON.stringify({ pinnedHistoryKeys: [] }) });
    const storage2 = createProfileStorage(backend2);
    expect(readProfile(storage2).status).toBe("corrupt");
  });

  it("returns status=unsupportedVersion when version !== 1, with a safe default profile", () => {
    const backend = makeMemoryBackend({
      [PROFILE_KEY]: JSON.stringify({ version: 2, pinnedHistoryKeys: ["asset:A"] }),
    });
    const storage = createProfileStorage(backend);
    const { profile, status } = readProfile(storage);
    expect(status).toBe("unsupportedVersion");
    expect(profile).toEqual(defaultProfile());
  });

  it("returns status=storageError when getItem itself throws", () => {
    const backend = makeThrowingBackend({ onGetItem: true });
    const storage = createProfileStorage(backend);
    const { profile, status } = readProfile(storage);
    expect(status).toBe("storageError");
    expect(profile).toEqual(defaultProfile());
  });

  it("returns status=ok for a normal saved profile, including a normally-saved empty profile", () => {
    const backend = makeMemoryBackend({ [PROFILE_KEY]: JSON.stringify(defaultProfile()) });
    const storage = createProfileStorage(backend);
    const { profile, status } = readProfile(storage);
    expect(status).toBe("ok");
    expect(profile).toEqual(defaultProfile());
  });

  it("returns status=ok and normalizes a saved profile that needs cleanup", () => {
    const backend = makeMemoryBackend({
      [PROFILE_KEY]: JSON.stringify({
        version: 1,
        primaryHistoryKey: "asset:X",
        pinnedHistoryKeys: ["asset:A", "asset:A"],
        goals: {},
      }),
    });
    const storage = createProfileStorage(backend);
    const { profile, status } = readProfile(storage);
    expect(status).toBe("ok");
    expect(profile.pinnedHistoryKeys).toEqual(["asset:A"]);
    expect(profile.primaryHistoryKey).toBe("asset:A");
  });
});

// ---------------------------------------------------------------------------
// 4. writeProfile
// ---------------------------------------------------------------------------

describe("writeProfile", () => {
  it("normalizes before persisting and returns ok:true on success", () => {
    const backend = makeMemoryBackend();
    const storage = createProfileStorage(backend);
    const messy = {
      version: 1,
      primaryHistoryKey: "asset:MISSING",
      pinnedHistoryKeys: ["asset:A", "asset:A", "asset:B"],
      goals: {},
    };
    const result = writeProfile(storage, messy);
    expect(result).toEqual({ ok: true });
    const stored = JSON.parse(backend.getItem(PROFILE_KEY));
    expect(stored.pinnedHistoryKeys).toEqual(["asset:A", "asset:B"]);
    expect(stored.primaryHistoryKey).toBe("asset:A");
  });

  it("returns ok:false and leaves the existing stored value untouched when setItem throws", () => {
    const previousValue = JSON.stringify({
      version: 1,
      primaryHistoryKey: "asset:OLD",
      pinnedHistoryKeys: ["asset:OLD"],
      goals: {},
    });
    const backend = {
      store: new Map([[PROFILE_KEY, previousValue]]),
      getItem(key) {
        return this.store.has(key) ? this.store.get(key) : null;
      },
      setItem() {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      },
    };
    const storage = createProfileStorage(backend);
    const result = writeProfile(storage, { version: 1, primaryHistoryKey: null, pinnedHistoryKeys: [], goals: {} });
    expect(result).toEqual({ ok: false });
    expect(backend.getItem(PROFILE_KEY)).toBe(previousValue);
  });
});

// ---------------------------------------------------------------------------
// 5. save-then-commit (verified as plain function composition, no React)
// ---------------------------------------------------------------------------

describe("save-then-commit composition", () => {
  function saveThenCommit(storage, currentProfile, mutate) {
    const { profile: next, code } = mutate(currentProfile);
    if (code !== "added" && code !== "removed" && code !== "set" && code !== "cleared") {
      return { ok: false, code, profile: currentProfile };
    }
    const { ok } = writeProfile(storage, next);
    if (!ok) {
      return { ok: false, code: "saveFailed", profile: currentProfile };
    }
    return { ok: true, code, profile: next };
  }

  it("confirms the next profile only when the write succeeds", () => {
    const backend = makeMemoryBackend();
    const storage = createProfileStorage(backend);
    const current = defaultProfile();
    const result = saveThenCommit(storage, current, (p) => addPin(p, "asset:A"));
    // normalizeProfile (§3 rule 3) auto-promotes the first pin to primary
    // whenever the current primary is not a valid pinned key (including null).
    expect(result).toEqual({
      ok: true,
      code: "added",
      profile: { ...defaultProfile(), primaryHistoryKey: "asset:A", pinnedHistoryKeys: ["asset:A"] },
    });
  });

  it("keeps the current profile and reports saveFailed when persistence fails, without deleting the existing value", () => {
    const previousValue = JSON.stringify({
      version: 1,
      primaryHistoryKey: "asset:OLD",
      pinnedHistoryKeys: ["asset:OLD"],
      goals: {},
    });
    const backend = {
      store: new Map([[PROFILE_KEY, previousValue]]),
      getItem(key) {
        return this.store.has(key) ? this.store.get(key) : null;
      },
      setItem() {
        throw new Error("boom");
      },
    };
    const storage = createProfileStorage(backend);
    const current = normalizeProfile(JSON.parse(previousValue));
    const result = saveThenCommit(storage, current, (p) => addPin(p, "asset:B"));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("saveFailed");
    expect(result.profile).toEqual(current);
    expect(backend.getItem(PROFILE_KEY)).toBe(previousValue);
  });

  it("re-reads a normalized value on load (round-trip through readProfile)", () => {
    const backend = makeMemoryBackend({
      [PROFILE_KEY]: JSON.stringify({
        version: 1,
        primaryHistoryKey: "asset:GONE",
        pinnedHistoryKeys: ["asset:A", "asset:A", "asset:B"],
        goals: {},
      }),
    });
    const storage = createProfileStorage(backend);
    const { profile } = readProfile(storage);
    expect(profile.pinnedHistoryKeys).toEqual(["asset:A", "asset:B"]);
    expect(profile.primaryHistoryKey).toBe("asset:A");
  });
});

// ---------------------------------------------------------------------------
// 6. addPin
// ---------------------------------------------------------------------------

describe("addPin", () => {
  it("adds a new pin", () => {
    const result = addPin(defaultProfile(), "asset:A");
    expect(result.code).toBe("added");
    expect(result.profile.pinnedHistoryKeys).toEqual(["asset:A"]);
  });

  it("reports alreadyPinned without changing the profile", () => {
    const base = { ...defaultProfile(), pinnedHistoryKeys: ["asset:A"] };
    const result = addPin(base, "asset:A");
    expect(result.code).toBe("alreadyPinned");
    expect(result.profile.pinnedHistoryKeys).toEqual(["asset:A"]);
  });

  it("reports limitReached at 3 pins and does not auto-evict anyone (4th pin rejected)", () => {
    const base = {
      ...defaultProfile(),
      pinnedHistoryKeys: ["asset:A", "asset:B", "asset:C"],
    };
    const result = addPin(base, "asset:D");
    expect(result.code).toBe("limitReached");
    expect(result.profile.pinnedHistoryKeys).toEqual(["asset:A", "asset:B", "asset:C"]);
  });

  it("reports invalidKey for empty/missing historyKey", () => {
    expect(addPin(defaultProfile(), "").code).toBe("invalidKey");
    expect(addPin(defaultProfile(), null).code).toBe("invalidKey");
    expect(addPin(defaultProfile(), undefined).code).toBe("invalidKey");
  });
});

// ---------------------------------------------------------------------------
// 7. removePin
// ---------------------------------------------------------------------------

describe("removePin", () => {
  it("removes a non-primary pinned key", () => {
    const base = {
      ...defaultProfile(),
      primaryHistoryKey: "asset:A",
      pinnedHistoryKeys: ["asset:A", "asset:B"],
    };
    const result = removePin(base, "asset:B");
    expect(result.code).toBe("removed");
    expect(result.profile.pinnedHistoryKeys).toEqual(["asset:A"]);
    expect(result.profile.primaryHistoryKey).toBe("asset:A");
  });

  it("reassigns primary to the remaining first pin when the primary is removed", () => {
    const base = {
      ...defaultProfile(),
      primaryHistoryKey: "asset:A",
      pinnedHistoryKeys: ["asset:A", "asset:B"],
    };
    const result = removePin(base, "asset:A");
    expect(result.code).toBe("removed");
    expect(result.profile.pinnedHistoryKeys).toEqual(["asset:B"]);
    expect(result.profile.primaryHistoryKey).toBe("asset:B");
  });

  it("sets primary to null when removing the last remaining pin", () => {
    const base = { ...defaultProfile(), primaryHistoryKey: "asset:A", pinnedHistoryKeys: ["asset:A"] };
    const result = removePin(base, "asset:A");
    expect(result.profile.pinnedHistoryKeys).toEqual([]);
    expect(result.profile.primaryHistoryKey).toBeNull();
  });

  it("does not delete goals when a pin is removed", () => {
    const base = {
      ...defaultProfile(),
      primaryHistoryKey: "asset:A",
      pinnedHistoryKeys: ["asset:A"],
      goals: { "asset:A": goodGoal },
    };
    const result = removePin(base, "asset:A");
    expect(result.profile.goals).toEqual({ "asset:A": goodGoal });
  });

  it("reports notPinned / invalidKey", () => {
    expect(removePin(defaultProfile(), "asset:NOPE").code).toBe("notPinned");
    expect(removePin(defaultProfile(), "").code).toBe("invalidKey");
  });
});

// ---------------------------------------------------------------------------
// 8. setPrimaryPin
// ---------------------------------------------------------------------------

describe("setPrimaryPin", () => {
  it("sets primary when the key is pinned", () => {
    const base = { ...defaultProfile(), pinnedHistoryKeys: ["asset:A", "asset:B"] };
    const result = setPrimaryPin(base, "asset:B");
    expect(result.code).toBe("set");
    expect(result.profile.primaryHistoryKey).toBe("asset:B");
  });

  it("reports notPinned when the key is not pinned, leaving the (normalized) profile unchanged", () => {
    const base = { ...defaultProfile(), pinnedHistoryKeys: ["asset:A"] };
    const result = setPrimaryPin(base, "asset:B");
    expect(result.code).toBe("notPinned");
    // normalizeProfile auto-promotes the sole pin to primary (§3 rule 3);
    // this rejected mutation must not change that already-normalized state.
    expect(result.profile.primaryHistoryKey).toBe("asset:A");
    expect(result.profile.pinnedHistoryKeys).toEqual(["asset:A"]);
  });

  it("reports invalidKey for empty historyKey", () => {
    expect(setPrimaryPin(defaultProfile(), "").code).toBe("invalidKey");
  });
});

// ---------------------------------------------------------------------------
// 9. setGoalIn
// ---------------------------------------------------------------------------

describe("setGoalIn", () => {
  it("sets a valid goal", () => {
    const result = setGoalIn(defaultProfile(), "asset:A", goodGoal);
    expect(result.code).toBe("set");
    expect(result.profile.goals["asset:A"]).toEqual(goodGoal);
  });

  it("reports invalidGoal and does not clear an existing goal", () => {
    const base = { ...defaultProfile(), goals: { "asset:A": goodGoal } };
    const result = setGoalIn(base, "asset:A", { targetLevel: "bad", targetDateIso: "2026-09-01" });
    expect(result.code).toBe("invalidGoal");
    expect(result.profile.goals).toEqual({ "asset:A": goodGoal });
  });

  it("reports invalidKey for empty historyKey", () => {
    expect(setGoalIn(defaultProfile(), "", goodGoal).code).toBe("invalidKey");
  });

  it("does not judge achieved/past-date semantics (T4a scope)", () => {
    // A goal with a date already in the "past" relative to any notion of "today"
    // is still accepted as long as it is a valid calendar date + level.
    const result = setGoalIn(defaultProfile(), "asset:A", { targetLevel: 226, targetDateIso: "2000-01-01" });
    expect(result.code).toBe("set");
    expect(result.profile.goals["asset:A"]).toEqual({ targetLevel: 226, targetDateIso: "2000-01-01" });
  });
});

// ---------------------------------------------------------------------------
// 10. clearGoalIn
// ---------------------------------------------------------------------------

describe("clearGoalIn", () => {
  it("clears an existing goal", () => {
    const base = { ...defaultProfile(), goals: { "asset:A": goodGoal } };
    const result = clearGoalIn(base, "asset:A");
    expect(result.code).toBe("cleared");
    expect(result.profile.goals).toEqual({});
  });

  it("reports noGoal when there is nothing to clear", () => {
    const result = clearGoalIn(defaultProfile(), "asset:A");
    expect(result.code).toBe("noGoal");
  });

  it("reports invalidKey for empty historyKey", () => {
    expect(clearGoalIn(defaultProfile(), "").code).toBe("invalidKey");
  });
});

// ---------------------------------------------------------------------------
// 11. interpretStorageEvent
// ---------------------------------------------------------------------------

describe("interpretStorageEvent", () => {
  it("ignores events for unrelated keys (returns null)", () => {
    expect(interpretStorageEvent({ key: "some_other_key", newValue: "{}" })).toBeNull();
  });

  it("ignores legacy favorites/groups keys", () => {
    expect(interpretStorageEvent({ key: "msu_exp_ranking_favorites", newValue: "[]" })).toBeNull();
    expect(interpretStorageEvent({ key: "msu_exp_ranking_groups", newValue: "[]" })).toBeNull();
    expect(interpretStorageEvent({ key: "msu_exp_ranking_active_group", newValue: "g_1" })).toBeNull();
  });

  it("returns an empty profile when newValue is null (deleted in another tab)", () => {
    const result = interpretStorageEvent({ key: PROFILE_KEY, newValue: null });
    expect(result).not.toBeNull();
    expect(result.profile).toEqual(defaultProfile());
  });

  it("does not throw/crash on a corrupted newValue and returns a safe default", () => {
    const result = interpretStorageEvent({ key: PROFILE_KEY, newValue: "{not json" });
    expect(result.status).toBe("corrupt");
    expect(result.profile).toEqual(defaultProfile());
  });

  it("normalizes a well-formed newValue", () => {
    const raw = JSON.stringify({
      version: 1,
      primaryHistoryKey: "asset:A",
      pinnedHistoryKeys: ["asset:A", "asset:A"],
      goals: {},
    });
    const result = interpretStorageEvent({ key: PROFILE_KEY, newValue: raw });
    expect(result.status).toBe("ok");
    expect(result.profile.pinnedHistoryKeys).toEqual(["asset:A"]);
  });

  it("flags unsupportedVersion for a recognizable-but-newer version payload", () => {
    const raw = JSON.stringify({ version: 99, pinnedHistoryKeys: ["asset:A"] });
    const result = interpretStorageEvent({ key: PROFILE_KEY, newValue: raw });
    expect(result.status).toBe("unsupportedVersion");
  });

  it("returns null for a null/undefined event", () => {
    expect(interpretStorageEvent(null)).toBeNull();
    expect(interpretStorageEvent(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 12. Unsupported version is non-destructive: mutation helpers never persist
//     when the loaded status is unsupportedVersion.
// ---------------------------------------------------------------------------

describe("unsupported version is non-destructive", () => {
  it("readProfile does not attempt to persist anything by itself", () => {
    const backend = makeMemoryBackend({
      [PROFILE_KEY]: JSON.stringify({ version: 2, pinnedHistoryKeys: ["asset:A"] }),
    });
    const storage = createProfileStorage(backend);
    const original = backend.getItem(PROFILE_KEY);
    readProfile(storage);
    // The stored (unrecognized-version) payload must remain byte-for-byte untouched.
    expect(backend.getItem(PROFILE_KEY)).toBe(original);
  });

  it("a mutation gate keyed on load status refuses to run mutations and reports unsupportedVersion", () => {
    // This models how ProfileContext must gate mutations: if the loaded
    // status was unsupportedVersion, no pure helper / writeProfile call
    // happens at all — the caller must short-circuit before invoking them.
    function gatedAddPin(loadStatus, storage, profile, historyKey) {
      if (loadStatus === "unsupportedVersion") {
        return { ok: false, code: "unsupportedVersion", profile };
      }
      const { profile: next, code } = addPin(profile, historyKey);
      if (code !== "added") {
        return { ok: false, code, profile };
      }
      const { ok } = writeProfile(storage, next);
      return ok ? { ok: true, code, profile: next } : { ok: false, code: "saveFailed", profile };
    }

    const backend = makeMemoryBackend({
      [PROFILE_KEY]: JSON.stringify({ version: 2, pinnedHistoryKeys: ["asset:A"] }),
    });
    const storage = createProfileStorage(backend);
    const { profile, status } = readProfile(storage);
    const before = backend.getItem(PROFILE_KEY);

    const result = gatedAddPin(status, storage, profile, "asset:B");
    expect(result).toEqual({ ok: false, code: "unsupportedVersion", profile });
    expect(backend.getItem(PROFILE_KEY)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 13. Common result-code shape { ok, code, profile }
// ---------------------------------------------------------------------------

describe("common result shape via a save-then-commit wrapper", () => {
  function commit(storage, profile, mutate, successCodes) {
    const { profile: next, code } = mutate(profile);
    if (!successCodes.includes(code)) {
      return { ok: false, code, profile };
    }
    const { ok } = writeProfile(storage, next);
    return ok ? { ok: true, code, profile: next } : { ok: false, code: "saveFailed", profile };
  }

  it("pin / unpin / setPrimary / setGoal / clearGoal all share { ok, code, profile }", () => {
    const storage = createProfileStorage(makeMemoryBackend());
    let profile = defaultProfile();

    let result = commit(storage, profile, (p) => addPin(p, "asset:A"), ["added"]);
    expect(result).toEqual(expect.objectContaining({ ok: true, code: "added" }));
    profile = result.profile;

    result = commit(storage, profile, (p) => setGoalIn(p, "asset:A", goodGoal), ["set"]);
    expect(result).toEqual(expect.objectContaining({ ok: true, code: "set" }));
    profile = result.profile;

    result = commit(storage, profile, (p) => setPrimaryPin(p, "asset:A"), ["set"]);
    expect(result).toEqual(expect.objectContaining({ ok: true, code: "set" }));
    profile = result.profile;

    result = commit(storage, profile, (p) => clearGoalIn(p, "asset:A"), ["cleared"]);
    expect(result).toEqual(expect.objectContaining({ ok: true, code: "cleared" }));
    profile = result.profile;

    result = commit(storage, profile, (p) => removePin(p, "asset:A"), ["removed"]);
    expect(result).toEqual(expect.objectContaining({ ok: true, code: "removed" }));
    for (const r of [result]) {
      expect(r).toHaveProperty("ok");
      expect(r).toHaveProperty("code");
      expect(r).toHaveProperty("profile");
    }
  });
});

// ---------------------------------------------------------------------------
// 14. §3 before/after JSON round-trip
// ---------------------------------------------------------------------------

describe("§3 before/after example round-trip", () => {
  it("matches the documented normalization example exactly", () => {
    const before = {
      version: 1,
      primaryHistoryKey: "asset:X",
      pinnedHistoryKeys: ["asset:A", "asset:A", "asset:B", "asset:C", "asset:D", ""],
      goals: {
        "asset:A": { targetLevel: 250, targetDateIso: "2026-09-01" },
        "asset:B": { targetLevel: "bad", targetDateIso: "2026-09-01" },
      },
    };
    const after = {
      version: 1,
      primaryHistoryKey: "asset:A",
      pinnedHistoryKeys: ["asset:A", "asset:B", "asset:C"],
      goals: { "asset:A": { targetLevel: 250, targetDateIso: "2026-09-01" } },
    };
    expect(normalizeProfile(before)).toEqual(after);

    // Round-trip through the storage adapter too.
    const backend = makeMemoryBackend();
    const storage = createProfileStorage(backend);
    writeProfile(storage, before);
    const { profile, status } = readProfile(storage);
    expect(status).toBe("ok");
    expect(profile).toEqual(after);
  });
});
