import { describe, expect, it } from "vitest";
import preset from "./presets.json";

function labels(presetData) {
  return [
    ...(presetData.tasks || []).map((task) => task.label),
    ...(presetData.templates || []).flatMap((template) => [
      template.label,
      ...(template.children || []).map((child) => child.label),
    ]),
    ...(presetData.eventTemplates || []).map((template) => template.label),
    ...(presetData.events || []).flatMap((event) => [
      event.label,
      ...(event.tasks || []).map((task) => task.label),
    ]),
  ];
}

describe("operator template contract", () => {
  it("uses schema v2 and has no missing Japanese labels", () => {
    expect(preset.schemaVersion).toBe(2);
    expect(typeof preset.version).toBe("string");
    expect(labels(preset).filter((label) => typeof label?.ja !== "string" || !label.ja.trim())).toEqual([]);
    const ids = (preset.templates || []).map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps initial tasks empty and offers the requested Symbol Daily template", () => {
    expect(preset.tasks).toEqual([]);
    const symbol = preset.templates.find((template) => template.id === "template:daily:symbol");
    expect(symbol).toMatchObject({ cadence: "daily", label: { ja: "シンボルデイリー" } });
    expect(symbol.children.map((child) => child.label.ja)).toEqual([
      "消滅", "チューチュー", "レヘルン", "アルカナ", "モラス", "エスフェラ",
    ]);
  });

  it("offers the requested Weekly Boss template", () => {
    const weeklyBosses = preset.templates.find((template) => template.id === "template:weekly:bosses");
    expect(weeklyBosses).toMatchObject({ cadence: "weekly", label: { ja: "ウィークリーボス" } });
    expect(weeklyBosses.children.map((child) => child.label.ja)).toEqual([
      "シグナス", "ジャクム", "PB", "ヒルラ", "バンバン", "ピエール", "クイーン",
      "ベルルム", "マグナス", "ビシャス", "ガデスラ", "スウ", "デミアン", "ルシード",
    ]);
  });
  it("offers the selected Hyper Summer task templates", () => {
    const daily = preset.templates.find((template) => template.id === "template:daily:hyper-summer");
    expect(daily).toMatchObject({ cadence: "daily", endsAt: "2026-07-22T23:59:00.000Z", label: { ja: "Hyper Summer Daily" } });
    expect(daily.children.map((child) => child.label.ja)).toEqual(["Raise the Golden Octopus"]);

    const weekly = preset.templates.find((template) => template.id === "template:weekly:hyper-summer");
    expect(weekly.children.map((child) => child.label.ja)).toEqual([
      "Gold Richie Coin Exchange",
      "1st World Mu Lung Tournament報酬",
      "Pick a Pearl!",
      "Gold Richie Coin Shop交換",
    ]);
    expect(preset.templates.find((template) => template.id === "template:weekly:maplers-shop"))
      .toMatchObject({ cadence: "weekly", label: { ja: "Maplers Shop購入" }, children: [] });
  });

  it("requires every limited-event task template to carry distributable UTC deadlines", () => {
    const limited = preset.templates.filter((template) => template.eventLimited);
    expect(limited.length).toBeGreaterThan(0);
    for (const template of limited) {
      const parentDeadline = template.endsAt && Number.isFinite(new Date(template.endsAt).getTime());
      const childDeadlines = template.children.length > 0
        && template.children.every((child) => child.endsAt && Number.isFinite(new Date(child.endsAt).getTime()));
      expect(parentDeadline || childDeadlines, template.id).toBe(true);
    }
  });
  it("offers Monster Park as a Daily template", () => {
    expect(preset.templates.find((template) => template.id === "template:daily:monster-park"))
      .toMatchObject({ cadence: "daily", label: { ja: "モンスターパーク" }, children: [] });
  });

  it("offers the provided operator event templates with valid ranges", () => {
    expect(preset.eventTemplates).toHaveLength(4);
    expect(preset.eventTemplates.map((template) => template.label.ja)).toEqual([
      "Tropical Adventure", "7-Star Catered Buffet", "VIP Membership", "Super Burning Chance",
    ]);
    expect(preset.eventTemplates.every((template) => new Date(template.startsAt) < new Date(template.endsAt))).toBe(true);
    expect(new Set(preset.eventTemplates.map((template) => template.id)).size).toBe(4);
  });
});

