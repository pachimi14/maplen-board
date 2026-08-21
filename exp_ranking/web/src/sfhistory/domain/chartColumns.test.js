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
import { filledBandRange, isOpenPoint, withChartColumns } from "./chartColumns.js";

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

// IMPL_PLAN_SH38 §1/§4-2: `filledBandRange` -- the x-range to shade for
// "this span includes a `priceGapFill.js`-filled point". Rows below use
// plain "d0".."d4" `date`/`displayDate` strings (in ascending order) rather
// than real ISO timestamps for `displayDate` -- `filledBandRange` never
// re-derives `displayDate`, it only reads it back off each row, so a bare
// placeholder string is enough to prove the returned `x1`/`x2` are the
// exact `displayDate` values of the right rows.
function row(date) {
  return { date, displayDate: `display-${date}` };
}

describe("filledBandRange (IMPL_PLAN_SH38 §1)", () => {
  it("no filled bands at all -> null (plan (c): 埋めが無ければ帯を出さない)", () => {
    const rows = [row("2026-08-17T00:00:00Z"), row("2026-08-18T00:00:00Z")];
    expect(filledBandRange(rows, [])).toBeNull();
    expect(filledBandRange(rows, undefined)).toBeNull();
  });

  it("empty rows -> null", () => {
    expect(filledBandRange([], [{ upgrade: 12, untilDate: "2026-08-17T20:00:00Z" }])).toBeNull();
  });

  it("a single filled band: shades from the first row through the last row strictly before untilDate", () => {
    const rows = [
      row("2026-08-16T00:00:00Z"),
      row("2026-08-16T04:00:00Z"),
      row("2026-08-17T20:00:00Z"), // exactly untilDate -- the first REAL point, not filled
      row("2026-08-18T00:00:00Z"),
    ];
    const range = filledBandRange(rows, [{ upgrade: 12, untilDate: "2026-08-17T20:00:00Z" }]);
    expect(range).toEqual({ x1: rows[0].displayDate, x2: rows[1].displayDate });
  });

  it("multiple filled bands with different untilDate: the union is the MAX untilDate (plan §4-2: always contiguous, never fragmented)", () => {
    const rows = [
      row("2026-08-16T00:00:00Z"),
      row("2026-08-17T20:00:00Z"), // ☆13's untilDate -- real for ☆13, still filled for ☆19
      row("2026-08-20T00:00:00Z"), // ☆19's untilDate -- the first row real for every filled band
      row("2026-08-20T04:00:00Z"),
    ];
    const filledBands = [
      { upgrade: 12, untilDate: "2026-08-17T20:00:00Z" }, // ☆13
      { upgrade: 18, untilDate: "2026-08-20T00:00:00Z" }, // ☆19
    ];
    const range = filledBandRange(rows, filledBands);
    // union = every row strictly before max(untilDate) = 08-20T00:00 -> rows[0..1]
    expect(range).toEqual({ x1: rows[0].displayDate, x2: rows[1].displayDate });
  });

  it("the fill entirely precedes the visible period slice -> null (every onscreen point is already real)", () => {
    const rows = [row("2026-08-21T00:00:00Z"), row("2026-08-21T04:00:00Z")];
    const range = filledBandRange(rows, [{ upgrade: 12, untilDate: "2026-08-17T20:00:00Z" }]);
    expect(range).toBeNull();
  });

  it("the visible period slice starts mid-fill: x1 is still the slice's own first row, x2 the last filled row in view", () => {
    // Full history's fill ends 08-20T00:00, but the visible (sliced) window
    // itself only starts 08-19T00:00 -- every row shown is still before the
    // band's end, so the whole visible window is shaded.
    const rows = [row("2026-08-19T00:00:00Z"), row("2026-08-19T20:00:00Z")];
    const range = filledBandRange(rows, [{ upgrade: 18, untilDate: "2026-08-20T00:00:00Z" }]);
    expect(range).toEqual({ x1: rows[0].displayDate, x2: rows[1].displayDate });
  });

  it("a malformed/unparseable untilDate is ignored, not thrown", () => {
    const rows = [row("2026-08-16T00:00:00Z")];
    expect(filledBandRange(rows, [{ upgrade: 12, untilDate: "not-a-date" }])).toBeNull();
    expect(filledBandRange(rows, [{ upgrade: 12 }])).toBeNull();
  });
});
