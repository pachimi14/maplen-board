import { createDefaultDashboardState, DASHBOARD_SCHEMA_VERSION, DASHBOARD_STORAGE_KEY, normalizeDashboardState } from "../domain/dashboardModel.js";
import { readVersionedState, writeVersionedState } from "./versionedStorage.js";
import { useVersionedStore } from "./useVersionedStore.js";

export function useDashboardStore(backend = window.localStorage) {
  return useVersionedStore({
    key: DASHBOARD_STORAGE_KEY,
    normalize: normalizeDashboardState,
    read: () => {
      const current = readVersionedState(backend, {
        key: DASHBOARD_STORAGE_KEY,
        versionField: "schemaVersion",
        version: DASHBOARD_SCHEMA_VERSION,
        normalize: normalizeDashboardState,
        createDefault: createDefaultDashboardState,
      });
      if (current.status !== "unsupportedVersion") return current;
      try {
        const legacy = JSON.parse(backend?.getItem(DASHBOARD_STORAGE_KEY) || "null");
        if ([1, 2].includes(legacy?.schemaVersion)) return { state: normalizeDashboardState(legacy), status: "ok" };
      } catch {
        return { state: createDefaultDashboardState(), status: "corrupt" };
      }
      return current;
    },
    write: (state) => writeVersionedState(backend, DASHBOARD_STORAGE_KEY, state, normalizeDashboardState),
  });
}
