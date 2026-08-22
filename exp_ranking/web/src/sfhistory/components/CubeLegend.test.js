import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CUBE_TYPE_ORDER } from "../domain/cubeSeries.js";

// vitest.config.js (untouched by this plan) has no `@vitejs/plugin-react`,
// so esbuild's classic JSX transform is used for imported .jsx files here,
// which compiles to bare `React.createElement(...)` calls expecting a
// module-scope `React` identifier -- this global is that identifier, not a
// new dependency (`react` is already a project dependency).
globalThis.React = React;

// IMPL_PLAN_SH45: measured proof that the merged legend row (a) IS the
// comparison control, (b) marks a selected additional cube type with a
// border class, (c) never lets the MAIN entry become a click target, and
// never offers MAIN as one of the ADDITIONAL toggles (no duplicate control,
// SH-44's own carried-over constraint). Uses `react-dom/server` directly
// (already a project dependency, `react-dom`) rather than adding a new
// testing-library dependency (plan §5-2 stop condition: no new deps).
vi.mock("../../i18n/I18nContext.jsx", () => ({
  useTranslation: () => ({ t: (key) => key }),
}));

const { default: CubeLegend } = await import("./CubeLegend.jsx");

const COLOR_BY_TYPE = { RED: "#e11d48", BLACK: "#0f172a", ADDITIONAL: "#a855f7", WHITE_ADDITIONAL: "#e2e8f0" };

function render(props) {
  return renderToStaticMarkup(createElement(CubeLegend, props));
}

describe("CubeLegend (IMPL_PLAN_SH45)", () => {
  it("(a) renders exactly 1 non-interactive main entry + 3 clickable additional buttons", () => {
    const html = render({ mainCubeType: "RED", additionalCubeTypes: [], colorByType: COLOR_BY_TYPE, onToggleAdditional: () => {} });
    const buttonCount = (html.match(/<button/g) || []).length;
    expect(buttonCount).toBe(CUBE_TYPE_ORDER.length - 1);
  });

  it("(c) the MAIN entry is never a <button> -- it cannot be clicked away", () => {
    const html = render({ mainCubeType: "RED", additionalCubeTypes: [], colorByType: COLOR_BY_TYPE, onToggleAdditional: () => {} });
    const mainSpanIndex = html.indexOf("sfh-cube-legend-item-main");
    const firstButtonIndex = html.indexOf("<button");
    expect(mainSpanIndex).toBeGreaterThan(-1);
    // The main entry's own markup (a <span>) appears before any <button>.
    expect(mainSpanIndex).toBeLessThan(firstButtonIndex);
    expect(html.slice(0, firstButtonIndex)).not.toContain("<button");
  });

  it("no duplicate control: MAIN cube type is never offered as one of the additional toggle buttons", () => {
    for (const mainCubeType of CUBE_TYPE_ORDER) {
      const html = render({ mainCubeType, additionalCubeTypes: [], colorByType: COLOR_BY_TYPE, onToggleAdditional: () => {} });
      const buttonCount = (html.match(/<button/g) || []).length;
      expect(buttonCount).toBe(CUBE_TYPE_ORDER.length - 1);
    }
  });

  it("(b) an unselected additional cube type has no selected-border class and aria-pressed=false", () => {
    const html = render({ mainCubeType: "RED", additionalCubeTypes: [], colorByType: COLOR_BY_TYPE, onToggleAdditional: () => {} });
    expect(html).not.toContain("sfh-cube-legend-item-selected");
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('aria-pressed="true"');
  });

  it("(b) a selected additional cube type gets the selected-border class and aria-pressed=true, others stay unselected", () => {
    const html = render({
      mainCubeType: "RED",
      additionalCubeTypes: ["BLACK"],
      colorByType: COLOR_BY_TYPE,
      onToggleAdditional: () => {},
    });
    expect(html).toContain("sfh-cube-legend-item-selected");
    expect((html.match(/aria-pressed="true"/g) || []).length).toBe(1);
    expect((html.match(/aria-pressed="false"/g) || []).length).toBe(2);
  });

  it("swatch (color dot) is present for every entry regardless of selection state", () => {
    const html = render({ mainCubeType: "RED", additionalCubeTypes: [], colorByType: COLOR_BY_TYPE, onToggleAdditional: () => {} });
    const swatchCount = (html.match(/sfh-cube-swatch/g) || []).length;
    expect(swatchCount).toBe(CUBE_TYPE_ORDER.length); // main + 3 additional, all shown
  });
});
