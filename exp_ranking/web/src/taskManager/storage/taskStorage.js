import {
  createDefaultTaskState,
  normalizeTaskState,
  LEGACY_TASKS_SCHEMA_VERSION,
  TASKS_SCHEMA_VERSION,
  TASKS_STORAGE_KEY,
  SUPPORTED_TASKS_SCHEMA_VERSIONS,
} from "../domain/taskModel.js";

export const BACKUP_FORMAT = "maplen-board-tasks-backup";

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createTaskStorage(backend = typeof window !== "undefined" ? window.localStorage : null) {
  return {
    read() {
      return backend?.getItem(TASKS_STORAGE_KEY) ?? null;
    },
    write(serialized) {
      if (!backend) throw new Error("Storage unavailable");
      backend.setItem(TASKS_STORAGE_KEY, serialized);
    },
  };
}

export function classifyTaskPayload(raw, presetVersion = "") {
  if (raw === null || raw === undefined) {
    return { state: createDefaultTaskState(presetVersion), status: "missing" };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: createDefaultTaskState(presetVersion), status: "corrupt" };
  }
  if (!isObject(parsed) || !Object.prototype.hasOwnProperty.call(parsed, "schemaVersion")) {
    return { state: createDefaultTaskState(presetVersion), status: "corrupt" };
  }
  if (!SUPPORTED_TASKS_SCHEMA_VERSIONS.includes(parsed.schemaVersion)) {
    return { state: createDefaultTaskState(presetVersion), status: "unsupportedVersion" };
  }
  return {
    state: normalizeTaskState(parsed, presetVersion),
    status: parsed.schemaVersion !== TASKS_SCHEMA_VERSION ? "migrated" : "ok",
  };
}

export function readTaskState(storage, presetVersion = "") {
  try {
    const result = classifyTaskPayload(storage.read(), presetVersion);
    if (result.status !== "migrated") return result;
    const saved = writeTaskState(storage, result.state);
    return saved.ok
      ? { state: saved.state, status: "ok" }
      : { state: result.state, status: "storageError" };
  } catch {
    return { state: createDefaultTaskState(presetVersion), status: "storageError" };
  }
}

export function writeTaskState(storage, state) {
  const normalized = normalizeTaskState(state, state?.presetVersion);
  try {
    storage.write(JSON.stringify(normalized));
    return { ok: true, state: normalized };
  } catch {
    return { ok: false, state: normalized };
  }
}

export function interpretTaskStorageEvent(event, presetVersion = "") {
  if (!event || event.key !== TASKS_STORAGE_KEY) return null;
  return classifyTaskPayload(event.newValue ?? null, presetVersion);
}

export function exportTaskBackup(state, exportedAt = new Date()) {
  const normalized = normalizeTaskState(state, state?.presetVersion);
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      schemaVersion: TASKS_SCHEMA_VERSION,
      exportedAt: new Date(exportedAt).toISOString(),
      state: normalized,
    },
    null,
    2,
  );
}

export function importTaskBackup(serialized, presetVersion = "") {
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { ok: false, code: "invalidJson" };
  }
  if (!isObject(parsed) || parsed.format !== BACKUP_FORMAT || !isObject(parsed.state)) {
    return { ok: false, code: "invalidFormat" };
  }
  const supported = SUPPORTED_TASKS_SCHEMA_VERSIONS;
  if (!supported.includes(parsed.schemaVersion) || parsed.schemaVersion !== parsed.state.schemaVersion) {
    return { ok: false, code: "unsupportedVersion" };
  }
  return { ok: true, code: "ok", state: normalizeTaskState(parsed.state, presetVersion) };
}

