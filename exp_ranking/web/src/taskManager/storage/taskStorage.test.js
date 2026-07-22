import { describe, expect, it } from "vitest";
import { createDefaultTaskState } from "../domain/taskModel.js";
import {
  classifyTaskPayload,
  createTaskStorage,
  exportTaskBackup,
  importTaskBackup,
  readTaskState,
  writeTaskState,
} from "./taskStorage.js";

function memoryBackend(initial = null) {
  let value = initial;
  const writtenKeys = [];
  return {
    getItem: () => value,
    setItem: (key, next) => { writtenKeys.push(key); value = next; },
    value: () => value,
    writtenKeys: () => writtenKeys,
  };
}

describe("task storage", () => {
  it("classifies missing, corrupt, unsupported, and storage errors", () => {
    expect(classifyTaskPayload(null).status).toBe("missing");
    expect(classifyTaskPayload("{").status).toBe("corrupt");
    expect(classifyTaskPayload(JSON.stringify({ schemaVersion: 1 })).status).toBe("migrated");
    expect(classifyTaskPayload(JSON.stringify({ schemaVersion: 99 })).status).toBe("unsupportedVersion");
    expect(readTaskState({ read() { throw new Error("blocked"); } }).status).toBe("storageError");
  });

  it("migrates a v1 payload in place without losing tasks, overrides, or completions", () => {
    const legacy = {
      schemaVersion: 1,
      presetVersion: "v1",
      taskOverrides: { "user:a": { notify: true } },
      customTasks: [{
        id: "user:a", title: "既存", cadence: "daily", notify: false,
        assignment: { mode: "shared", historyKeys: [] }, createdAt: "2026-07-20T00:00:00Z",
      }],
      completions: { "user:a": { "day:2026-07-20": { shared: "2026-07-20T12:00:00Z", characters: {} } } },
    };
    const backend = memoryBackend(JSON.stringify(legacy));
    const result = readTaskState(createTaskStorage(backend), "v2");
    expect(result.status).toBe("ok");
    expect(result.state).toMatchObject({ schemaVersion: 9, presetVersion: "v1" });
    expect(result.state.customTasks[0]).toMatchObject({ id: "user:a", title: "既存", children: [] });
    expect(result.state.taskOverrides["user:a"].notify).toBe(true);
    expect(result.state.completions["user:a"]["day:2026-07-20"].shared).toBe("2026-07-20T12:00:00Z");
    expect(JSON.parse(backend.value()).schemaVersion).toBe(9);
    expect(backend.writtenKeys()).toEqual(["maplen-board-tasks-v1"]);
  });
  it("writes only through the scoped adapter", () => {
    const backend = memoryBackend();
    const result = writeTaskState(createTaskStorage(backend), createDefaultTaskState("v1"));
    expect(result.ok).toBe(true);
    expect(JSON.parse(backend.value()).presetVersion).toBe("v1");
    expect(backend.writtenKeys()).toEqual(["maplen-board-tasks-v1"]);
  });

  it("round-trips an exported backup", () => {
    const state = { ...createDefaultTaskState("v1"), taskOverrides: { a: { notify: true } } };
    const exported = exportTaskBackup(state, "2026-07-20T00:00:00Z");
    const imported = importTaskBackup(exported, "v2");
    expect(imported.ok).toBe(true);
    expect(imported.state).toEqual(state);
  });

  it("imports a legacy v1 backup as schema v9", () => {
    const legacyState = {
      schemaVersion: 1, presetVersion: "v1", taskOverrides: {}, completions: {},
      customTasks: [{
        id: "user:legacy", title: "旧タスク", cadence: "weekly", notify: false,
        assignment: { mode: "shared", historyKeys: [] }, createdAt: null,
      }],
    };
    const result = importTaskBackup(JSON.stringify({
      format: "maplen-board-tasks-backup", schemaVersion: 1, state: legacyState,
    }), "v2");
    expect(result.ok).toBe(true);
    expect(result.state).toMatchObject({ schemaVersion: 9 });
    expect(result.state.customTasks[0]).toMatchObject({ id: "user:legacy", children: [] });
  });
  it("does not accept arbitrary JSON as a backup", () => {
    expect(importTaskBackup(JSON.stringify(createDefaultTaskState())).code).toBe("invalidFormat");
  });
});

