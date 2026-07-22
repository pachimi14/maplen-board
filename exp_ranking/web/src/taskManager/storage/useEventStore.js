import { createDefaultEventState, EVENTS_SCHEMA_VERSION, EVENTS_STORAGE_KEY, normalizeEventState } from "../domain/eventModel.js";
import { readVersionedState, writeVersionedState } from "./versionedStorage.js";
import { useVersionedStore } from "./useVersionedStore.js";
export function useEventStore(backend = window.localStorage) { return useVersionedStore({ key: EVENTS_STORAGE_KEY, normalize: normalizeEventState, read: () => readVersionedState(backend,{key:EVENTS_STORAGE_KEY,versionField:"schemaVersion",version:EVENTS_SCHEMA_VERSION,normalize:normalizeEventState,createDefault:createDefaultEventState}), write: (state) => writeVersionedState(backend,EVENTS_STORAGE_KEY,state,normalizeEventState) }); }
