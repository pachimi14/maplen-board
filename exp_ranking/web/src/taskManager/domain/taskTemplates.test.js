import { describe, expect, it } from "vitest";
import preset from "../data/presets.json";
import { instantiateTaskTemplate, listTaskTemplates, migrateInstalledTemplateDeadlines } from "./taskTemplates.js";

describe("task template installation", () => {
  it("lists each template only for its cadence", () => {
    const weekly = listTaskTemplates(preset, "weekly")[0];
    expect(weekly).toMatchObject({
      id: "template:weekly:bosses",
      cadence: "weekly",
      title: "ウィークリーボス",
    });
    expect(weekly.children).toHaveLength(14);
    expect(weekly.children.slice(0, 3)).toEqual([{ title: "シグナス" }, { title: "ジャクム" }, { title: "ピンクビーン" }]);
    expect(listTaskTemplates(preset, "daily")[0]).toMatchObject({
      id: "template:daily:symbol",
      title: "シンボルデイリー",
      cadence: "daily",
      children: [{ title: "消滅の旅路" }, { title: "チューチューアイランド" }, { title: "レヘルン" }, { title: "アルカナ" }, { title: "モラス" }, { title: "エスフェラ" }],
    });
  });

  it("creates independent editable copies with unique parent and child IDs", () => {
    let sequence = 0;
    const createId = (prefix) => `${prefix}:${++sequence}`;
    const template = listTaskTemplates(preset, "daily")[0];
    const first = instantiateTaskTemplate(template, createId, "2026-07-20T12:00:00Z");
    const second = instantiateTaskTemplate(template, createId, "2026-07-20T12:00:00Z");
    const firstIds = [first.id, ...first.children.map((child) => child.id)];
    const secondIds = [second.id, ...second.children.map((child) => child.id)];
    expect(first).toMatchObject({ title: "シンボルデイリー", cadence: "daily" });
    expect(first.children).toHaveLength(6);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(14);
  });

  it("filters expired templates and children at the exact UTC deadline", () => {
    const before = listTaskTemplates(preset, "weekly", "ja", "2026-07-22T23:58:59.999Z")
      .find((template) => template.id === "template:weekly:hyper-summer");
    expect(before.children).toHaveLength(4);
    const afterEvent = listTaskTemplates(preset, "weekly", "ja", "2026-07-22T23:59:00.000Z")
      .find((template) => template.id === "template:weekly:hyper-summer");
    expect(afterEvent.children.map((child) => child.title)).toEqual(["Pick a Pearl!", "Gold Richie Coin Shop交換"]);
    const shopOnly = listTaskTemplates(preset, "weekly", "ja", "2026-08-20T00:00:00.000Z")
      .find((template) => template.id === "template:weekly:hyper-summer");
    expect(shopOnly.children.map((child) => child.title)).toEqual(["Gold Richie Coin Shop交換"]);
    expect(listTaskTemplates(preset, "weekly", "ja", "2026-08-23T23:59:00.000Z")
      .find((template) => template.id === "template:weekly:hyper-summer")).toBeUndefined();
  });

  it("copies child deadlines into the independent editable task", () => {
    let sequence = 0;
    const template = listTaskTemplates(preset, "weekly", "ja", "2026-07-20T00:00:00.000Z")
      .find((item) => item.id === "template:weekly:hyper-summer");
    const task = instantiateTaskTemplate(template, (prefix) => `${prefix}:${++sequence}`, "2026-07-20T00:00:00.000Z");
    expect(task.children.map((child) => child.endsAt)).toEqual([
      "2026-07-22T23:59:00.000Z", "2026-07-22T23:59:00.000Z",
      "2026-08-19T23:59:00.000Z", "2026-08-23T23:59:00.000Z",
    ]);
  });
  it("backfills deadlines for installed event parents and uniquely named children without overriding user edits", () => {
    const legacy = {
      schemaVersion: 4, presetVersion: "old", taskOverrides: {}, completions: {},
      customTasks: [{
        id: "user:daily", templateId: "template:daily:hyper-summer", title: "Hyper Summer0����", cadence: "daily", endsAt: null, deadlineCustomized: false, children: [],
      }, {
        id: "user:legacy", title: "名前を変更済み", cadence: "weekly", children: [
          { id: "child:shop", title: "Gold Richie Coin Shop交換", endsAt: null, deadlineCustomized: false },
          { id: "child:edited", title: "Pick a Pearl!", endsAt: null, deadlineCustomized: true },
        ],
      }],
    };
    const migrated = migrateInstalledTemplateDeadlines(legacy, preset);
    expect(migrated.customTasks[0].endsAt).toBe("2026-07-22T23:59:00.000Z");
    expect(migrated.customTasks[1].children[0].endsAt).toBe("2026-08-23T23:59:00.000Z");
    expect(migrated.customTasks[1].children[1].endsAt).toBeNull();
  });
});

