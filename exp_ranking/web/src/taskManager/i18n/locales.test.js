import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import ja from "./locales/ja.json";

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

describe("Task Manager locale catalogs", () => {
  it.each([
    ["ja", ja],
    ["en", en],
  ])("keeps the %s catalog structurally complete", (_language, catalog) => {
    expect(leafShape(catalog)).toEqual(leafShape(ja));
  });
});
