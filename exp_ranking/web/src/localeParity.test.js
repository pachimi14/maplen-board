import { describe, expect, it } from "vitest";
import en from "./i18n/locales/en.json";
import es from "./i18n/locales/es.json";
import ja from "./i18n/locales/ja.json";
import th from "./i18n/locales/th.json";
import vi from "./i18n/locales/vi.json";
import zhTW from "./i18n/locales/zh-TW.json";

// LULU-062 basis 12: this PR (docs/IMPL_PLAN_exp-table-era.md) is a bot-side
// EXP-table era fix with "new locale keys: none" as an explicit constraint
// (CLAUDE.md: adding UI copy requires all 6 locales in the same commit).
// This pins the pre-existing, must-stay-true invariant -- every locale has
// exactly the same flattened key set as every other one -- as a regression
// test, so any future PR that adds a key to one locale but forgets the
// other 5 fails CI instead of silently shipping a fallback/blank string.
const LOCALES = { ja, en, "zh-TW": zhTW, th, vi, es };

function flattenKeys(node, prefix = "") {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    return [prefix];
  }
  return Object.entries(node).flatMap(([key, value]) =>
    flattenKeys(value, prefix ? `${prefix}.${key}` : key)
  );
}

describe("locale key parity (LULU-062 basis 12: 6 locales, key set unchanged by this PR)", () => {
  const keySetsByLocale = Object.fromEntries(
    Object.entries(LOCALES).map(([code, messages]) => [code, new Set(flattenKeys(messages))])
  );
  const referenceCode = "en";
  const referenceKeys = keySetsByLocale[referenceCode];

  it("has a non-trivial reference key set to compare against (sanity check)", () => {
    expect(referenceKeys.size).toBeGreaterThan(100);
  });

  for (const code of Object.keys(LOCALES)) {
    if (code === referenceCode) continue;

    it(`${code}.json has exactly the same key set as ${referenceCode}.json (no missing, no extra)`, () => {
      const keys = keySetsByLocale[code];
      const missing = [...referenceKeys].filter((key) => !keys.has(key));
      const extra = [...keys].filter((key) => !referenceKeys.has(key));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });
  }
});
