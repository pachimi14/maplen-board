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
// comparison control, (b)/(l)/(p) marks a selected additional cube type
// with a REAL, computed inline border-color (not just a class name --
// 統括 差し戻し: the class alone was not proof anything painted), (c)/(n)
// never lets the MAIN entry become a click target or get a selected
// border-color, and never offers MAIN as one of the ADDITIONAL toggles (no
// duplicate control, SH-44's own carried-over constraint). Uses
// `react-dom/server` directly (already a project dependency, `react-dom`)
// rather than adding a new testing-library dependency (plan §5-2 stop
// condition: no new deps) -- `renderToStaticMarkup` serializes React's
// `style` object into a literal `style="border-color:..."` string, so
// asserting on that string is a direct, SSR-observable proof that a
// border-color reaches the rendered markup, immune to any CSS
// cascade/specificity/layer/HMR-caching ambiguity a real browser's CSS
// engine could otherwise introduce.
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

  it("(b) an unselected additional cube type has no selected-border class, no inline border-color, and aria-pressed=false", () => {
    const html = render({ mainCubeType: "RED", additionalCubeTypes: [], colorByType: COLOR_BY_TYPE, onToggleAdditional: () => {} });
    expect(html).not.toContain("sfh-cube-legend-item-selected");
    // §差し戻し (l)/(p): a class name being ABSENT is not, by itself, proof
    // that nothing paints a border -- assert directly that no inline
    // `border-color` is emitted anywhere in this render at all (there is
    // exactly one place that can emit one -- the selected branch below).
    expect(html).not.toContain("border-color");
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('aria-pressed="true"');
  });

  it("(l)/(p) a selected additional cube type's own <button> carries a real, visible, computed border-color (not just the class name)", () => {
    for (const selectedType of ["BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"]) {
      const html = render({
        mainCubeType: "RED",
        additionalCubeTypes: [selectedType],
        colorByType: COLOR_BY_TYPE,
        onToggleAdditional: () => {},
      });
      expect(html).toContain("sfh-cube-legend-item-selected");
      expect((html.match(/aria-pressed="true"/g) || []).length).toBe(1);
      expect((html.match(/aria-pressed="false"/g) || []).length).toBe(2);
      // The one place `border-color` can appear is the inline `style` this
      // plan's revision adds to CubeLegend.jsx (`isOn ? { borderColor:
      // cubeColor, ... } : undefined`) -- renderToStaticMarkup serializes
      // React's `style` object into a real `style="border-color:...` CSS
      // string, so this is the SSR-observable proof that a border-color
      // actually reaches the rendered markup, not merely that a class name
      // is present (統括's own bug report: the class WAS present, the
      // paint was not). It must be present exactly once (only the selected
      // button gets it) and must equal that cube type's OWN resolved
      // color (統括 instruction: "枠の色はそのキューブの色を使う"), never
      // a generic/shared fallback color.
      const styleMatches = html.match(/style="border-color:([^;"]+)/g) || [];
      expect(styleMatches).toHaveLength(1);
      expect(styleMatches[0]).toBe(`style="border-color:${COLOR_BY_TYPE[selectedType]}`);
    }
  });

  it("(n) the MAIN entry never gets a selected border-color, even if it happens to match an additional type's color", () => {
    // Same color reused for main and an additional type on purpose here --
    // proves the border-color, when it appears, is scoped to the
    // <button> React actually attached it to, not merely "this color
    // appears somewhere in the output".
    const sharedColor = "#123456";
    const html = render({
      mainCubeType: "RED",
      additionalCubeTypes: ["BLACK"],
      colorByType: { ...COLOR_BY_TYPE, RED: sharedColor, BLACK: sharedColor },
      onToggleAdditional: () => {},
    });
    const mainMarkup = html.slice(0, html.indexOf("<button"));
    expect(mainMarkup).not.toContain("border-color");
  });

  it("swatch (color dot) is present for every entry regardless of selection state", () => {
    const html = render({ mainCubeType: "RED", additionalCubeTypes: [], colorByType: COLOR_BY_TYPE, onToggleAdditional: () => {} });
    const swatchCount = (html.match(/sfh-cube-swatch/g) || []).length;
    expect(swatchCount).toBe(CUBE_TYPE_ORDER.length); // main + 3 additional, all shown
  });
});
