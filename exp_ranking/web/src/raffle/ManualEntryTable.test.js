import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Same SSR approach as src/sfhistory/components/CubeLegend.test.js: no new
// testing dependency; vitest's classic JSX transform needs a global React.
globalThis.React = React;
vi.mock("../i18n/I18nContext.jsx", () => ({
  useTranslation: () => ({ t: (key) => key }),
}));

const { default: ManualEntryTable } = await import("./ManualEntryTable.jsx");

const ALL_ON = { coin: true, equipment: true, ftItem: true, box: true, bossNeso: true, powerCrystal: true, ascendantNeso: true };
const memberMap = { "member-1": { assetKey: "CHARa", displayName: "Alice" }, "member-2": { assetKey: "CHARb", displayName: "Bob" } };
const entriesByAssetKey = {
  CHARa: { bossNeso: "30000000", coinQuantity: "2", coinSaleNeso: "10000000", equipment: [{ rowId: "r1", name: "Arcane Hat", saleNeso: "101" }] },
};

function render(include) {
  return renderToStaticMarkup(createElement(ManualEntryTable, { boss: "WILL", include, partyOrder: ["member-1", "member-2"], memberMap, entriesByAssetKey, onChange: () => {} }));
}

describe("ManualEntryTable (LULU-145 #6)", () => {
  it("renders one block per member with grouped values and the 5% fee preview", () => {
    const html = render(ALL_ON);
    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
    expect(html).toContain('value="30,000,000"');
    expect(html).toContain("9,500,000 NESO");
    expect(html).toContain("95 NESO");
    expect(html).toContain("Arachno Coin");
    expect(html).toContain("raffle.manualBlankIsZero");
    expect((html.match(/data-manual-field="coin"/g) || [])).toHaveLength(2);
  });

  it("does not render the inputs of unchecked items, and shows them (with values) again once re-checked", () => {
    const off = render({ ...ALL_ON, coin: false, equipment: false, bossNeso: false, ftItem: false });
    expect(off).not.toContain('data-manual-field="coin"');
    expect(off).not.toContain('data-manual-field="equipment"');
    expect(off).not.toContain('data-manual-field="ftItem"');
    expect(off).not.toContain("raffle.item_bossNeso");
    expect(off).not.toContain('value="30,000,000"');
    expect(off).not.toContain("Arcane Hat");
    expect(off).toContain('data-manual-field="box"');
    const on = render(ALL_ON);
    expect(on).toContain('value="30,000,000"');
    expect(on).toContain('value="Arcane Hat"');
    expect(on).toContain('data-manual-field="ftItem"');
  });
});
