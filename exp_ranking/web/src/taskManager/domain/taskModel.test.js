import { describe, expect, it } from "vitest";
import {
  addChildTask,
  addTaskTab,
  addCustomTask,
  createDefaultTaskState,
  getTaskProgress,
  normalizeTaskState,
  removeChildTask,
  removeTaskTab,
  removeCustomTask,
  reorderChildTasks,
  reorderItems,
  renameTaskTab,
  setTaskOverride,
  toggleTaskCompletion,
  updateChildTask,
  updateCustomTask,
} from "./taskModel.js";

function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

const customInput = {
  id: "user:test",
  title: "テストタスク",
  cadence: "daily",
  notify: false,
  assignment: { mode: "shared", historyKeys: [] },
  createdAt: "2026-07-20T00:00:00.000Z",
};

describe("task state", () => {
  it("migrates notification settings into schema version 9", () => {
    const state = normalizeTaskState({ schemaVersion: 9, presetVersion: "p1", taskOverrides: {}, customTasks: [], completions: {}, notificationSettings: { timeZone: "Asia/Tokyo", daily: { enabled: true, time: "21:15" } } });
    expect(state.schemaVersion).toBe(9);
    expect(state.notificationSettings).toMatchObject({ timeZone: "Asia/Tokyo", daily: { enabled: true, time: "21:15" } });
  });
  it("adds a custom task without mutating the input", () => {
    const original = deepFreeze(createDefaultTaskState("p1"));
    const result = addCustomTask(original, customInput);
    expect(result.code).toBe("added");
    expect(result.state.customTasks).toHaveLength(1);
    expect(original.customTasks).toHaveLength(0);
  });

  it("promotes a normal task to a derived-progress group and demotes it after the last child is removed", () => {
    let state = addCustomTask(createDefaultTaskState(), customInput).state;
    const parent = { id: "user:test", cadence: "daily", assignment: customInput.assignment };
    state = toggleTaskCompletion(state, parent, "2026-07-20T12:00:00.000Z");
    expect(getTaskProgress(state, parent, "2026-07-20T12:00:00.000Z").completed).toBe(true);

    state = addChildTask(state, "user:test", { id: "child:a", title: "子A" }).state;
    state = addChildTask(state, "user:test", { id: "child:b", title: "子B" }).state;
    const group = { ...parent, children: state.customTasks[0].children };
    expect(state.completions["user:test"]).toBeUndefined();
    expect(getTaskProgress(state, group, "2026-07-20T12:00:00.000Z")).toMatchObject({
      completed: false, completedCount: 0, totalCount: 2,
    });

    state = toggleTaskCompletion(state, group, "2026-07-20T12:00:00.000Z");
    expect(getTaskProgress(state, group, "2026-07-20T12:00:00.000Z")).toMatchObject({
      completed: true, completedCount: 2, totalCount: 2,
    });
    expect(getTaskProgress(state, group, "2026-07-21T00:00:00.000Z").completed).toBe(false);
    state = toggleTaskCompletion(state, { ...parent, id: "child:a" }, "2026-07-20T12:00:00.000Z");
    expect(getTaskProgress(state, group, "2026-07-20T12:00:00.000Z")).toMatchObject({
      completed: false, completedCount: 1, totalCount: 2,
    });

    state = removeChildTask(state, "user:test", "child:a").state;
    state = removeChildTask(state, "user:test", "child:b").state;
    expect(state.customTasks[0].children).toEqual([]);
    expect(state.completions["child:a"]).toBeUndefined();
    expect(state.completions["child:b"]).toBeUndefined();
  });
  it("resets weekly group progress on Thursday and removes child completions with the group", () => {
    let state = addCustomTask(createDefaultTaskState(), {
      ...customInput,
      id: "user:weekly",
      cadence: "weekly",
    }).state;
    state = addChildTask(state, "user:weekly", { id: "child:weekly-a", title: "項目A" }).state;
    state = addChildTask(state, "user:weekly", { id: "child:weekly-b", title: "項目B" }).state;
    const group = {
      id: "user:weekly",
      cadence: "weekly",
      assignment: customInput.assignment,
      children: state.customTasks[0].children,
    };

    state = toggleTaskCompletion(state, group, "2026-07-22T23:59:59.999Z");
    expect(getTaskProgress(state, group, "2026-07-22T23:59:59.999Z")).toMatchObject({
      completed: true, completedCount: 2, totalCount: 2,
    });
    expect(getTaskProgress(state, group, "2026-07-23T00:00:00.000Z")).toMatchObject({
      completed: false, completedCount: 0, totalCount: 2,
    });

    state = removeCustomTask(state, "user:weekly").state;
    expect(state.customTasks).toHaveLength(0);
    expect(state.completions["child:weekly-a"]).toBeUndefined();
    expect(state.completions["child:weekly-b"]).toBeUndefined();
  });
  it("reorders parent sequences and custom child tasks without mutating the input", () => {
    const items = deepFreeze([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(reorderItems(items, "a", "c", "after").map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(items.map((item) => item.id)).toEqual(["a", "b", "c"]);

    let state = addCustomTask(createDefaultTaskState(), {
      ...customInput,
      children: [{ id: "child:a", title: "A" }, { id: "child:b", title: "B" }, { id: "child:c", title: "C" }],
    }).state;
    state = reorderChildTasks(state, "user:test", "child:c", "child:a", "before").state;
    expect(state.customTasks[0].children.map((child) => child.id)).toEqual(["child:c", "child:a", "child:b"]);
  });
  it("renames an installed template parent and child without changing their IDs", () => {
    let state = addCustomTask(createDefaultTaskState(), {
      ...customInput,
      children: [{ id: "child:a", title: "消滅" }],
    }).state;
    state = updateCustomTask(state, "user:test", { title: "自分用シンボル" }).state;
    state = updateChildTask(state, "user:test", "child:a", { title: "消滅のデイリー" }).state;
    expect(state.customTasks[0]).toMatchObject({ id: "user:test", title: "自分用シンボル" });
    expect(state.customTasks[0].children[0]).toMatchObject({ id: "child:a", title: "消滅のデイリー" });
  });
  it("tracks completion per assigned historyKey and survives a name change", () => {
    let state = addCustomTask(createDefaultTaskState(), customInput).state;
    state = setTaskOverride(state, "user:test", {
      assignment: { mode: "characters", historyKeys: ["asset:one", "asset:two"] },
    });
    const task = {
      id: "user:test",
      cadence: "daily",
      assignment: state.taskOverrides["user:test"].assignment,
    };
    state = toggleTaskCompletion(state, task, "2026-07-20T12:00:00.000Z");
    const renamedTask = { ...task, displayNames: ["Changed", "Names"] };
    expect(getTaskProgress(state, renamedTask, "2026-07-20T18:00:00.000Z")).toMatchObject({
      completed: true,
      completedCount: 2,
      totalCount: 2,
    });
    expect(Object.keys(state.completions["user:test"]["day:2026-07-20"].characters)).toEqual([
      "asset:one",
      "asset:two",
    ]);
  });

  it("automatically becomes incomplete in the next cycle", () => {
    const task = { id: "user:test", cadence: "daily", assignment: { mode: "shared", historyKeys: [] } };
    const done = toggleTaskCompletion(createDefaultTaskState(), task, "2026-07-20T23:59:59.999Z");
    expect(getTaskProgress(done, task, "2026-07-20T23:59:59.999Z").completed).toBe(true);
    expect(getTaskProgress(done, task, "2026-07-21T00:00:00.000Z").completed).toBe(false);
  });


  it("preserves weekend availability only for weekly tasks", () => {
    const weekly = addCustomTask(createDefaultTaskState(), { ...customInput, cadence: "weekly", availability: "weekend" }).state;
    expect(weekly.customTasks[0].availability).toBe("weekend");
    const daily = addCustomTask(createDefaultTaskState(), { ...customInput, availability: "weekend" }).state;
    expect(daily.customTasks[0].availability).toBe("always");
  });
  it("strips unknown fields during normalization", () => {
    const normalized = normalizeTaskState({
      ...createDefaultTaskState(),
      injected: "nope",
      customTasks: [{ ...customInput, injected: true }],
    });
    expect(normalized.injected).toBeUndefined();
    expect(normalized.customTasks[0].injected).toBeUndefined();
  });

  it("migrates legacy task state and preserves editable parent and child deadlines", () => {
    const legacy = normalizeTaskState({
      schemaVersion: 3, presetVersion: "old", taskOverrides: {}, completions: {},
      customTasks: [{ ...customInput, children: [{ id: "child:deadline", title: "交換", endsAt: "2026-08-23T23:59:00Z" }] }],
    });
    expect(legacy.schemaVersion).toBe(9);
    expect(legacy.customTasks[0].children[0].endsAt).toBe("2026-08-23T23:59:00.000Z");
    let state = updateCustomTask(legacy, "user:test", { endsAt: "2026-08-19T23:59:00Z" }).state;
    state = updateChildTask(state, "user:test", "child:deadline", { endsAt: null }).state;
    expect(state.customTasks[0].endsAt).toBe("2026-08-19T23:59:00.000Z");
    expect(state.customTasks[0].children[0].endsAt).toBeNull();
  });

  it("creates, renames and safely removes shared tabs without deleting tasks", () => {
    let state = addCustomTask(createDefaultTaskState(), customInput).state;
    state = addTaskTab(state, { id: "tab:main", name: "メイン" }).state;
    state = setTaskOverride(state, "user:test", { tabId: "tab:main" });
    expect(state.taskTabs).toEqual([{ id: "tab:main", name: "メイン", createdAt: null }]);
    state = renameTaskTab(state, "tab:main", "メインキャラ").state;
    expect(state.taskTabs[0].name).toBe("メインキャラ");
    state = removeTaskTab(state, "tab:main").state;
    expect(state.taskTabs).toEqual([]);
    expect(state.customTasks).toHaveLength(1);
    expect(state.taskOverrides["user:test"].tabId).toBeUndefined();
  });

  it("merges legacy Daily and Weekly tabs with the same name and preserves membership", () => {
    const migrated = normalizeTaskState({
      schemaVersion: 6,
      presetVersion: "old",
      taskTabs: [
        { id: "tab:daily-main", cadence: "daily", name: "メイン" },
        { id: "tab:weekly-main", cadence: "weekly", name: "メイン" },
        { id: "tab:sub", cadence: "weekly", name: "サブ" },
      ],
      taskOverrides: {
        daily: { tabId: "tab:daily-main" },
        weekly: { tabId: "tab:weekly-main" },
        sub: { tabId: "tab:sub" },
      },
      customTasks: [],
      completions: {},
    });
    expect(migrated.schemaVersion).toBe(9);
    expect(migrated.taskTabs).toEqual([
      { id: "tab:daily-main", name: "メイン", createdAt: null },
      { id: "tab:sub", name: "サブ", createdAt: null },
    ]);
    expect(migrated.taskOverrides.daily.tabId).toBe("tab:daily-main");
    expect(migrated.taskOverrides.weekly.tabId).toBe("tab:daily-main");
    expect(migrated.taskOverrides.sub.tabId).toBe("tab:sub");
  });
  it("migrates completed character assignments to shared progress and removes assignment controls", () => {
    const migrated = normalizeTaskState({
      schemaVersion: 5, presetVersion: "old", taskTabs: [],
      customTasks: [{ ...customInput, assignment: { mode: "characters", historyKeys: ["pachimi"] } }],
      taskOverrides: {},
      completions: { "user:test": { "day:2026-07-20": { characters: { pachimi: "2026-07-20T12:00:00Z" } } } },
    });
    expect(migrated.schemaVersion).toBe(9);
    expect(migrated.customTasks[0].assignment).toEqual({ mode: "shared", historyKeys: [] });
    expect(migrated.completions["user:test"]["day:2026-07-20"].shared).toBe("2026-07-20T12:00:00Z");
  });
  it("keeps no-reset custom completion and separates repeating reset cycles", () => {
    const forever = { id: "user:forever", cadence: "custom", resetRule: { mode: "none" }, assignment: { mode: "shared", historyKeys: [] } };
    const doneForever = toggleTaskCompletion(createDefaultTaskState(), forever, "2026-07-21T00:00:00Z");
    expect(getTaskProgress(doneForever, forever, "2026-08-20T00:00:00Z").completed).toBe(true);
    const repeating = { id: "user:repeat", cadence: "custom", resetRule: { mode: "interval", firstAt: "2026-07-22T00:00:00Z", every: 1, unit: "week" }, assignment: { mode: "shared", historyKeys: [] } };
    const doneRepeat = toggleTaskCompletion(createDefaultTaskState(), repeating, "2026-07-21T23:59:59.999Z");
    expect(getTaskProgress(doneRepeat, repeating, "2026-07-21T23:59:59.999Z").completed).toBe(true);
    expect(getTaskProgress(doneRepeat, repeating, "2026-07-22T00:00:00.000Z").completed).toBe(false);
  });});

