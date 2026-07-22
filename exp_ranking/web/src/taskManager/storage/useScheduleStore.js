import { createDefaultScheduleState, normalizeScheduleState, SCHEDULE_SCHEMA_VERSION, SCHEDULE_STORAGE_KEY } from "../domain/scheduleModel.js";
import { readVersionedState, writeVersionedState } from "./versionedStorage.js";
import { useVersionedStore } from "./useVersionedStore.js";

export function useScheduleStore(backend = window.localStorage) {
  return useVersionedStore({
    key: SCHEDULE_STORAGE_KEY,
    normalize: normalizeScheduleState,
    read: () => readVersionedState(backend, {
      key: SCHEDULE_STORAGE_KEY,
      versionField: "schemaVersion",
      version: SCHEDULE_SCHEMA_VERSION,
      normalize: normalizeScheduleState,
      createDefault: createDefaultScheduleState,
    }),
    write: (state) => writeVersionedState(backend, SCHEDULE_STORAGE_KEY, state, normalizeScheduleState),
  });
}
