import { describe, expect, it } from "vitest";
import { mergeExtraSeriesColumns } from "./SfHistoryChart.jsx";

// IMPL_PLAN_SH44 §2-2/(j): unit coverage for the one new piece of logic
// this plan adds to the shared chart component -- everything else
// (`withChartColumns`/`withDeltas`/`filledBandRange`) is reused unmodified
// (already covered by `domain/chartColumns.test.js`/`domain/series.test.js`).
// This file can import a named export straight out of `SfHistoryChart.jsx`
// under the plain "node" vitest environment (no jsdom/testing-library)
// because importing a module never evaluates its JSX-returning function
// bodies -- `src/components/SiteHeader.test.js` already established this
// same pattern for `BoardHeader.jsx#resolveSiteNavHref`.
describe("mergeExtraSeriesColumns", () => {
  const mainRows = [
    { date: "2026-08-20T00:00:00Z", expected: 100, confirmed: 100, bridge: null },
    { date: "2026-08-20T04:00:00Z", expected: 110, confirmed: 110, bridge: null },
    { date: "2026-08-20T08:00:00Z", expected: null, confirmed: null, bridge: null },
  ];

  it("returns mainRows itself (not a copy) when extraRowsList is empty -- plan (j)", () => {
    expect(mergeExtraSeriesColumns(mainRows, [])).toBe(mainRows);
  });

  it("adds confirmed_<key>/bridge_<key> columns per extra series, matched by date", () => {
    const extraRowsList = [
      {
        key: "BLACK",
        rows: [
          { date: "2026-08-20T00:00:00Z", confirmed: 200, bridge: null },
          { date: "2026-08-20T04:00:00Z", confirmed: 210, bridge: null },
          { date: "2026-08-20T08:00:00Z", confirmed: null, bridge: null },
        ],
      },
      {
        key: "WHITE_ADDITIONAL",
        rows: [
          { date: "2026-08-20T00:00:00Z", confirmed: null, bridge: null },
          { date: "2026-08-20T04:00:00Z", confirmed: null, bridge: null },
          { date: "2026-08-20T08:00:00Z", confirmed: null, bridge: null },
        ],
      },
    ];
    const merged = mergeExtraSeriesColumns(mainRows, extraRowsList);
    expect(merged).toHaveLength(3);
    expect(merged[0]).toMatchObject({
      date: "2026-08-20T00:00:00Z",
      expected: 100,
      confirmed: 100,
      confirmed_BLACK: 200,
      bridge_BLACK: null,
      confirmed_WHITE_ADDITIONAL: null,
    });
    // K2 (plan (h)): a still-null cube slot (e.g. White Cube before its own
    // data start) stays null through the merge -- never 0, never filled.
    expect(merged[1].confirmed_WHITE_ADDITIONAL).toBeNull();
  });

  it("does not mutate mainRows' own row objects", () => {
    const extraRowsList = [{ key: "BLACK", rows: [{ date: "2026-08-20T00:00:00Z", confirmed: 200, bridge: null }] }];
    mergeExtraSeriesColumns(mainRows, extraRowsList);
    expect(mainRows[0]).not.toHaveProperty("confirmed_BLACK");
  });

  it("skips an extra row whose date has no match in mainRows (defensive only)", () => {
    const extraRowsList = [{ key: "BLACK", rows: [{ date: "1999-01-01T00:00:00Z", confirmed: 999, bridge: null }] }];
    const merged = mergeExtraSeriesColumns(mainRows, extraRowsList);
    expect(merged).toHaveLength(3);
    expect(merged.every((row) => !("confirmed_BLACK" in row) || row.confirmed_BLACK !== 999)).toBe(true);
  });

  it("preserves mainRows' own chronological order", () => {
    const merged = mergeExtraSeriesColumns(mainRows, [{ key: "BLACK", rows: [] }]);
    expect(merged.map((row) => row.date)).toEqual(mainRows.map((row) => row.date));
  });
});
