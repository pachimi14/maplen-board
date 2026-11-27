import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ja from "../../i18n/locales/ja.json";

globalThis.React = React;

// IMPL_PLAN_SH48 criteria #5/#6/#7: a PAIR of cases -- while the official
// current price is unavailable the two current-value cards are absent, and
// the same component handed `currentStatus: "ready"` shows both again
// (the auto-restore the plan requires). Real ja strings are used (not
// key echo) so "現在値" / "現在の位置" are asserted as actual DOM text.
function translate(key, params = {}) {
  const value = key.split(".").reduce((node, part) => node?.[part], ja);
  if (typeof value !== "string") return key;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(params[name]));
}

vi.mock("../../i18n/I18nContext.jsx", () => ({
  useTranslation: () => ({ t: translate, language: "ja" }),
}));

const { default: SummaryCards } = await import("./SummaryCards.jsx");

const STATS = { count: 3, average: 100, high: 200, low: 50 };
const END_DATE = "2026-11-25T04:00:00Z";

function render(props) {
  return renderToStaticMarkup(
    createElement(SummaryCards, { stats: STATS, percentile: 0.4, currentExpected: 123456, ...props }),
  );
}
const count = (html, needle) => html.split(needle).length - 1;

describe("SummaryCards (IMPL_PLAN_SH48)", () => {
  it("#5 hides the current-value and current-position cards when currentStatus is not ready", () => {
    for (const currentStatus of ["error", "loading", "idle"]) {
      const html = render({ currentStatus, dataEndDate: END_DATE });
      expect(count(html, "現在値")).toBe(0);
      expect(count(html, "現在の位置")).toBe(0);
      expect(count(html, "現在価格を取得できません")).toBe(0);
      // the three period cards stay
      expect(count(html, "期間平均")).toBe(1);
      expect(count(html, "期間高値")).toBe(1);
      expect(count(html, "期間安値")).toBe(1);
    }
  });

  it("#7 shows the cadence note and the data-as-of time once each when not ready", () => {
    const html = render({ currentStatus: "error", dataEndDate: END_DATE });
    expect(count(html, "1日1回（JST 17時頃）更新")).toBe(1);
    expect(count(html, "データは")).toBe(1);
    expect(html).toContain("2026");
  });

  it("omits the data-as-of time (never invents one) when endDate is absent", () => {
    const html = render({ currentStatus: "error", dataEndDate: null });
    expect(count(html, "1日1回（JST 17時頃）更新")).toBe(1);
    expect(count(html, "データは")).toBe(0);
  });

  it("#6 restores both original cards, and no cadence note, when currentStatus is ready", () => {
    const html = render({ currentStatus: "ready", dataEndDate: END_DATE, currentUpdatedAt: "2026-11-25T08:00:00Z" });
    expect(count(html, "現在値")).toBe(1);
    expect(count(html, "現在の位置")).toBe(1);
    expect(count(html, "1日1回")).toBe(0);
    expect(count(html, "データは")).toBe(0);
    expect(count(html, "現在価格を取得できません")).toBe(0);
  });
});
