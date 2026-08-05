// IMPL_PLAN_SH19 §1/§4 (2026-08-05 P0 regression, 統括 review): locks down
// the exact class of bug that shipped and slipped past `npm run test`
// initially -- `integrations/sfHistorySource.js` silently dropped the
// server's `closed` field before it ever reached this module, so every
// point defaulted to "closed" and the dashed `bridge` series was empty (0
// points, confirmed by measuring the rendered SVG's `<path d="">`) even
// though every OTHER test (domain/series.test.js, sfHistorySource.test.js's
// pre-fix version, pytest) was green. The assertions below are on `bridge`/
// `confirmed`'s actual VALUES (what recharts' `d` attribute is computed
// from), not just on `closed`/`provisional` flags surviving a pass-through
// -- this is what would have caught the P0 before it shipped.
import { describe, expect, it } from "vitest";
import { isOpenPoint, withChartColumns } from "./chartColumns.js";

function point(date, expected, extra = {}) {
  return { date, expected, provisional: false, closed: true, ...extra };
}

describe("withChartColumns (IMPL_PLAN_SH19 §1/§4: closed, not provisional, drives the split)", () => {
  it("the still-open point (closed:false): bridge gets exactly 2 non-null entries (last closed point + the open one), confirmed excludes the open point", () => {
    const series = [
      point("2026-08-05T00:00:00Z", 100),
      point("2026-08-05T04:00:00Z", 110), // last closed point
      point("2026-08-05T08:00:00Z", 999, { provisional: true, closed: false, asOf: "2026-08-05T08:20:00Z" }), // the one open point
    ];
    const data = withChartColumns(series);

    const bridgeNonNull = data.filter((row) => row.bridge != null);
    expect(bridgeNonNull).toHaveLength(2); // P0 regression: this was 0 before the fix
    expect(bridgeNonNull.map((row) => row.date)).toEqual([
      "2026-08-05T04:00:00Z",
      "2026-08-05T08:00:00Z",
    ]);
    expect(bridgeNonNull[0].bridge).toBe(110);
    expect(bridgeNonNull[1].bridge).toBe(999);

    // The solid line must stop one point short of the open point (P0
    // regression: this was NOT null before the fix, so the solid line
    // reached all the way to the chart's right edge).
    expect(data[0].confirmed).toBe(100);
    expect(data[1].confirmed).toBe(110);
    expect(data[2].confirmed).toBeNull();
  });

  it("an elapsed-but-unaggregated point (provisional:true, closed:true) is NOT the open point -- renders on the solid line, not the dashed one", () => {
    const series = [
      point("2026-08-05T00:00:00Z", 100),
      point("2026-08-05T04:00:00Z", 110, { provisional: true, closed: true }), // ended, just not persisted yet
      point("2026-08-05T08:00:00Z", 999, { provisional: true, closed: false }), // the still-open one
    ];
    const data = withChartColumns(series);

    expect(data[1].confirmed).toBe(110); // solid, not excluded
    expect(data[2].confirmed).toBeNull(); // only the truly open point is excluded

    const bridgeNonNull = data.filter((row) => row.bridge != null);
    expect(bridgeNonNull).toHaveLength(2); // bridges from the last CLOSED point (index 1) to the open one (index 2)
    expect(bridgeNonNull[0].date).toBe("2026-08-05T04:00:00Z");
    expect(bridgeNonNull[1].date).toBe("2026-08-05T08:00:00Z");
  });

  it("no open point at all: bridge is empty (0 non-null entries), confirmed covers every point", () => {
    const series = [point("2026-08-05T00:00:00Z", 100), point("2026-08-05T04:00:00Z", 110)];
    const data = withChartColumns(series);
    expect(data.every((row) => row.bridge == null)).toBe(true);
    expect(data.map((row) => row.confirmed)).toEqual([100, 110]);
  });

  it("a missing `closed` field defaults to closed (matches domain/series.js's own default) -- regression guard for the exact silent-drop bug", () => {
    const series = [{ date: "d", expected: 5, provisional: false }]; // no `closed` key at all
    expect(isOpenPoint(series[0])).toBe(false);
    const data = withChartColumns(series);
    expect(data[0].confirmed).toBe(5);
    expect(data[0].bridge).toBeNull();
  });
});
