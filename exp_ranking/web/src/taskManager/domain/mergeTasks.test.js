import { describe, expect, it } from "vitest";
import { mergeTasks, summarizeTasks } from "./mergeTasks.js";
import { addChildTask, addCustomTask, addTaskTab, createDefaultTaskState, setTaskOverride, toggleTaskCompletion } from "./taskModel.js";

const presetV1 = {
  schemaVersion: 1,
  version: "v1",
  tasks: [{ id: "daily:a", cadence: "daily", label: { ja: "A" }, defaultEnabled: true }],
  events: [],
};

const eventPreset = {
  schemaVersion: 1,
  version: "events-v1",
  tasks: [],
  events: [{
    id: "event:a",
    label: { ja: "イベントA" },
    startsAt: "2026-07-20T00:00:00.000Z",
    endsAt: "2026-07-21T00:00:00.000Z",
    claimEndsAt: "2026-07-22T00:00:00.000Z",
    tasks: [{ id: "event:a:daily", cadence: "daily", label: { ja: "イベントデイリー" } }],
  }],
};

describe("preset overlay merge", () => {
  it("preserves user overrides when the preset changes", () => {
    const state = setTaskOverride(createDefaultTaskState("v1"), "daily:a", { notify: true, order: 9 });
    const presetV2 = {
      ...presetV1,
      version: "v2",
      tasks: [...presetV1.tasks, { id: "daily:b", cadence: "daily", label: { ja: "B" } }],
    };
    const merged = mergeTasks(presetV2, state, "2026-07-20T12:00:00Z");
    expect(merged.daily).toHaveLength(2);
    expect(merged.daily.find((task) => task.id === "daily:a")).toMatchObject({ notify: true, order: 9 });
  });

  it("summarizes progress from the pure merged view", () => {
    const view = mergeTasks(presetV1, createDefaultTaskState(), "2026-07-20T12:00:00Z");
    const doneState = toggleTaskCompletion(createDefaultTaskState(), view.daily[0], "2026-07-20T12:00:00Z");
    const doneView = mergeTasks(presetV1, doneState, "2026-07-20T12:00:00Z");
    expect(summarizeTasks(doneView.daily)).toEqual({ total: 1, completed: 1, remaining: 0, percent: 100 });
  });

  it("merges group children with inherited cadence and derived parent progress", () => {
    let state = addCustomTask(createDefaultTaskState(), {
      id: "user:group", title: "週ボス", cadence: "weekly", notify: false,
      assignment: { mode: "shared", historyKeys: [] }, createdAt: "2026-07-20T00:00:00Z",
    }).state;
    state = addChildTask(state, "user:group", { id: "child:lotus", title: "スウ" }).state;
    state = addChildTask(state, "user:group", { id: "child:damien", title: "デミアン" }).state;
    let view = mergeTasks(presetV1, state, "2026-07-20T12:00:00Z");
    const group = view.weekly[0];
    expect(group.children.map((child) => [child.label, child.cadence, child.parentId])).toEqual([
      ["スウ", "weekly", "user:group"], ["デミアン", "weekly", "user:group"],
    ]);
    state = toggleTaskCompletion(state, group.children[0], "2026-07-20T12:00:00Z");
    view = mergeTasks(presetV1, state, "2026-07-20T12:00:00Z");
    expect(view.weekly[0].progress).toMatchObject({ completed: false, completedCount: 1, totalCount: 2 });
  });
  it("derives weekend availability when a Weekend reward task is installed", () => {
    const state = addCustomTask(createDefaultTaskState(), {
      id: "user:weekend",
      title: "Weekend報酬",
      cadence: "weekly",
      availability: "weekend",
      notify: false,
      assignment: { mode: "shared", historyKeys: [] },
      children: [],
      createdAt: "2026-07-18T00:00:00Z",
    }).state;

    expect(mergeTasks(presetV1, state, "2026-07-18T12:00:00Z").weekly[0].availabilityState).toBe("active");
    expect(mergeTasks(presetV1, state, "2026-07-19T12:00:00Z").weekly[0].availabilityState).toBe("closing");
    expect(mergeTasks(presetV1, state, "2026-07-20T12:00:00Z").weekly[0].availabilityState).toBe("upcoming");
  });
  it("shows event tasks only while the event itself is active", () => {
    expect(mergeTasks(eventPreset, createDefaultTaskState(), "2026-07-19T23:59:59.999Z").daily).toHaveLength(0);
    expect(mergeTasks(eventPreset, createDefaultTaskState(), "2026-07-20T00:00:00.000Z").daily).toHaveLength(1);
    const closing = mergeTasks(eventPreset, createDefaultTaskState(), "2026-07-21T00:00:00.000Z");
    expect(closing.daily).toHaveLength(0);
    expect(closing.events[0].status).toBe("closing");
    expect(mergeTasks(eventPreset, createDefaultTaskState(), "2026-07-22T00:00:00.000Z").events).toHaveLength(0);
  });

  it("keeps expiring children until the deadline and hides the parent after the last child expires", () => {
    const state = addCustomTask(createDefaultTaskState(), {
      id: "user:limited", title: "期間限定", cadence: "weekly", notify: false,
      children: [
        { id: "child:early", title: "早期終了", endsAt: "2026-07-22T23:59:00.000Z" },
        { id: "child:shop", title: "ショップ", endsAt: "2026-08-23T23:59:00.000Z" },
      ],
      createdAt: "2026-07-20T00:00:00.000Z",
    }).state;
    expect(mergeTasks(presetV1, state, "2026-07-22T23:58:59.999Z").weekly[0].children).toHaveLength(2);
    const afterEarly = mergeTasks(presetV1, state, "2026-07-22T23:59:00.000Z").weekly[0];
    expect(afterEarly.children.map((child) => child.label)).toEqual(["ショップ"]);
    expect(afterEarly.children[0].remainingMs).toBeGreaterThan(0);
    expect(mergeTasks(presetV1, state, "2026-08-23T23:59:00.000Z").weekly).toHaveLength(0);
    expect(state.customTasks[0].children).toHaveLength(2);
  });

  it("exposes the same shared tab IDs to Daily and Weekly tasks", () => {
    let state = addCustomTask(createDefaultTaskState(), { id: "user:tabbed", title: "メイン用", cadence: "daily", notify: false, children: [], createdAt: "2026-07-20T00:00:00Z" }).state;
    state = addTaskTab(state, { id: "tab:daily", name: "メイン" }).state;
    state = addTaskTab(state, { id: "tab:weekly", name: "週用" }).state;
    state = setTaskOverride(state, "user:tabbed", { tabId: "tab:daily" });
    let view = mergeTasks(presetV1, state, "2026-07-20T12:00:00Z");
    expect(view.daily.find((task) => task.id === "user:tabbed").tabId).toBe("tab:daily");
    state = setTaskOverride(state, "user:tabbed", { tabId: "tab:weekly" });
    view = mergeTasks(presetV1, state, "2026-07-20T12:00:00Z");
    expect(view.daily.find((task) => task.id === "user:tabbed").tabId).toBe("tab:weekly");
    expect(view.daily).toHaveLength(2);
  });
  it("keeps custom tasks after the due date and hides them at the display deadline", () => {
    const state = addCustomTask(createDefaultTaskState(), {
      id: "user:flex", title: "自由タスク", cadence: "custom", notify: true, children: [],
      resetRule: { mode: "interval", firstAt: "2026-07-22T00:00:00Z", every: 1, unit: "week" },
      dueAt: "2026-07-23T00:00:00Z", visibleUntil: "2026-07-25T00:00:00Z", createdAt: "2026-07-21T00:00:00Z",
    }).state;
    const before = mergeTasks(presetV1, state, "2026-07-22T00:00:00Z").custom[0];
    expect(before).toMatchObject({ dueOverdue: false, notify: true });
    expect(before.resetRemainingMs).toBeGreaterThan(0);
    const overdue = mergeTasks(presetV1, state, "2026-07-23T00:00:00Z").custom[0];
    expect(overdue.dueOverdue).toBe(true);
    expect(mergeTasks(presetV1, state, "2026-07-25T00:00:00Z").custom).toHaveLength(0);
  });});

