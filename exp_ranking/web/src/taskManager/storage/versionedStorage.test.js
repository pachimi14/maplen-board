import { describe, expect, it } from "vitest";
import { createDefaultDashboardState, normalizeDashboardState } from "../domain/dashboardModel.js";
import { readVersionedState, writeVersionedState } from "./versionedStorage.js";

function backend(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    value: (key) => data.get(key),
  };
}

const config = {
  key: "maplen-board-dashboard-v1",
  versionField: "schemaVersion",
  version: 2,
  normalize: normalizeDashboardState,
  createDefault: createDefaultDashboardState,
};

describe("versionedStorage", () => {
  it("classifies unsupported versions without overwriting them", () => {
    const store = backend({ [config.key]: JSON.stringify({ schemaVersion: 3, reminderMemo: "future" }) });
    expect(readVersionedState(store, config).status).toBe("unsupportedVersion");
    expect(store.value(config.key)).toContain("future");
  });

  it("writes only the configured key with normalized data", () => {
    const store = backend();
    expect(writeVersionedState(store, config.key, { schemaVersion: 2, reminderMemo: "memo" }, normalizeDashboardState).ok).toBe(true);
    expect(JSON.parse(store.value(config.key))).toEqual({ schemaVersion: 2, reminderMemo: "memo", dailyExpGoals: {}, legacyDailyExpGoal: "", themeColor: "green", themeDepth: "deep" });
  });
});

