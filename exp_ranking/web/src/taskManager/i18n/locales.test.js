import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import es from "./locales/es.json";
import ja from "./locales/ja.json";
import th from "./locales/th.json";
import vi from "./locales/vi.json";
import zhTW from "./locales/zh-TW.json";

function leafShape(value, prefix = "") {
  if (Array.isArray(value)) {
    return [`${prefix}[]:${value.length}`];
  }
  if (typeof value !== "object" || value === null) {
    return [prefix];
  }
  return Object.keys(value)
    .sort()
    .flatMap((key) => leafShape(value[key], prefix ? `${prefix}.${key}` : key));
}

function placeholderShape(value, prefix = "") {
  if (typeof value === "string") {
    return [[prefix, [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()]];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => placeholderShape(item, `${prefix}[${index}]`));
  }
  if (typeof value !== "object" || value === null) return [];
  return Object.keys(value).sort().flatMap((key) =>
    placeholderShape(value[key], prefix ? `${prefix}.${key}` : key));
}
describe("Task Manager locale catalogs", () => {
  it.each([
    ["ja", ja],
    ["en", en],
    ["es", es],
    ["th", th],
    ["vi", vi],
    ["zh-TW", zhTW],
  ])("keeps the %s catalog structurally complete", (_language, catalog) => {
    expect(leafShape(catalog)).toEqual(leafShape(ja));
    expect(placeholderShape(catalog)).toEqual(placeholderShape(ja));
  });
});
