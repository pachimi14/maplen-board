// IMPL_PLAN_SH20 -- the JS half of the response/normalization contract.
// `server/sf-history/contract/response_fields.json` is the single, shared
// source of truth for which fields `app.py`'s JSON responses may carry (the
// server's own `tests/test_response_contract.py` reads the same file). This
// module asserts that `normalizePricesPayload`/`normalizeLatestPayload`/
// `normalizeEquipmentPayload`'s OUTPUT keeps every field the contract lists,
// unless that field is deliberately listed in `INTENTIONALLY_DROPPED` below
// -- 3回同じ欠陥(SH-9/SH-16/SH-19)を防ぐための負のテスト: add a field to the
// contract and forget to pass it through here, and this file fails until
// either the pass-through or the `INTENTIONALLY_DROPPED` entry is added.
//
// Front example this follows: `exp_ranking/web/src/raffle/domain/
// contract.test.js` (reads a shared file with `readFileSync`, tests the
// domain module sitting right next to it -- no new tooling invented here).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeCubePricesPayload, normalizeEquipmentPayload, normalizeLatestPayload, normalizePricesPayload } from "./sfHistorySource.js";

const CONTRACT = JSON.parse(
  readFileSync(new URL("../../../../../server/sf-history/contract/response_fields.json", import.meta.url), "utf8"),
);

/** Contract fields the server may send that this frontend deliberately does
 * not need anywhere downstream. Listed here (never silently dropped) --
 * §4 of IMPL_PLAN_SH20 requires every current drop to be enumerated and
 * reported, not just left out of the normalizer with no trace. Adding a
 * field to the contract without either passing it through OR adding it here
 * fails the tests below (the negative-test property this file exists for). */
const INTENTIONALLY_DROPPED = {
  prices: {
    root: ["itemId", "interval", "labelIs", "upgradeCount"],
    point: [],
  },
  latest: {
    // IMPL_PLAN_SH41 §1: `cubes`/`cubeOrder` removed from this list --
    // `normalizeLatestPayload` now passes both through (this slice actually
    // uses them, CubePricesRoot.jsx). Only `itemId` (the request-echo field,
    // never needed downstream -- same treatment `prices.root` already gives
    // it) stays intentionally dropped.
    root: ["itemId"],
  },
  cubePrices: {
    // IMPL_PLAN_SH41 §1: same drop set as `prices.root` above, minus
    // `upgradeCount` (this route has no such field -- its counterpart,
    // `cubeOrder`, IS passed through). `itemId`/`interval`/`labelIs` are
    // dropped for the same reason `prices.root` drops them: the caller
    // already knows the itemId it requested, and every point on this route
    // is 4h/bucketStart the same way `prices` is, with nothing downstream
    // reading either field back off the normalized result.
    root: ["itemId", "interval", "labelIs"],
    point: [],
  },
  equipment: {
    root: ["generatedAt", "excluded"],
    item: [],
  },
};

function assertContractFieldsSurvive(contractFields, droppedFields, hasField, label) {
  for (const field of contractFields) {
    if (droppedFields.includes(field)) continue;
    expect(hasField(field), `contract field "${field}" (${label}) must survive normalization or be listed in INTENTIONALLY_DROPPED`).toBe(true);
  }
}

describe("contract: /sf-history/prices", () => {
  const rootPayload = {
    itemId: 1001,
    interval: "4h",
    labelIs: "bucketStart",
    startDate: "2026-01-01T00:00:00Z",
    endDate: "2026-01-05T00:00:00Z",
    provisionalDate: "2026-01-05T04:00:00Z",
    priceVersion: "v1",
    upgradeCount: 22,
    points: [{ date: "2026-01-01T00:00:00Z", prices: [1], closed: true }],
  };

  it("keeps every contract root field, or documents the drop", () => {
    const result = normalizePricesPayload(rootPayload, 1001);
    assertContractFieldsSurvive(
      CONTRACT.prices.root,
      INTENTIONALLY_DROPPED.prices.root,
      (field) => Object.prototype.hasOwnProperty.call(result, field),
      "prices.root",
    );
  });

  it("keeps every contract point field somewhere across the point shapes it can occur in, or documents the drop", () => {
    // one of each shape app.py's own docstring describes: confirmed (no
    // `provisional` key at all), elapsed-but-unaggregated-provisional (no
    // `asOf`), and the in-progress point (has `asOf`, `closed: false`).
    const payload = {
      itemId: 1001,
      points: [
        { date: "2026-01-01T00:00:00Z", prices: [1], closed: true },
        { date: "2026-01-02T00:00:00Z", prices: [1], provisional: true, closed: true },
        { date: "2026-01-03T00:00:00Z", prices: [1], provisional: true, closed: false, asOf: "2026-01-03T00:10:00Z" },
      ],
    };
    const result = normalizePricesPayload(payload, 1001);
    const seen = new Set();
    result.points.forEach((point) => Object.keys(point).forEach((key) => seen.add(key)));
    assertContractFieldsSurvive(
      CONTRACT.prices.point,
      INTENTIONALLY_DROPPED.prices.point,
      (field) => seen.has(field),
      "prices.point",
    );
  });
});

describe("contract: /sf-history/latest", () => {
  // IMPL_PLAN_SH40 carried `cubes`/`cubeOrder` on this response; IMPL_PLAN_SH41
  // §1 is what makes `normalizeLatestPayload` actually read them (see
  // INTENTIONALLY_DROPPED.latest.root above).
  const payload = {
    itemId: 1001,
    latestUpdatedAt: "2026-08-04T18:20:00Z",
    prices: [1, 2, null, 4],
    cubes: [1, null, null, null],
    cubeOrder: ["RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"],
  };

  it("keeps every contract root field, or documents the drop", () => {
    const result = normalizeLatestPayload(payload, 1001);
    assertContractFieldsSurvive(
      CONTRACT.latest.root,
      INTENTIONALLY_DROPPED.latest.root,
      (field) => Object.prototype.hasOwnProperty.call(result, field),
      "latest.root",
    );
  });

  // IMPL_PLAN_SH41 §1 accept criterion (a): the exact regression this slice
  // exists to fix -- `cubes`/`cubeOrder` must actually reach the returned
  // object now, not just be absent from INTENTIONALLY_DROPPED (a field could
  // vanish from that list by mistake while the normalizer still silently
  // drops it; this pins the real value, not just presence-of-key).
  it("passes through cubes/cubeOrder (IMPL_PLAN_SH41 §1: no longer intentionally dropped)", () => {
    const result = normalizeLatestPayload(payload, 1001);
    expect(result.cubes).toEqual([1, null, null, null]);
    expect(result.cubeOrder).toEqual(["RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"]);
  });
});

describe("contract: /sf-history/cube-prices", () => {
  const rootPayload = {
    itemId: 1001,
    interval: "4h",
    labelIs: "bucketStart",
    startDate: "2026-01-01T00:00:00Z",
    endDate: "2026-01-05T00:00:00Z",
    provisionalDate: "2026-01-05T04:00:00Z",
    priceVersion: "v1",
    cubeOrder: ["RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"],
    points: [{ date: "2026-01-01T00:00:00Z", cubes: [1, 2, 3, null], closed: true }],
  };

  it("keeps every contract root field, or documents the drop", () => {
    const result = normalizeCubePricesPayload(rootPayload, 1001);
    assertContractFieldsSurvive(
      CONTRACT.cubePrices.root,
      INTENTIONALLY_DROPPED.cubePrices.root,
      (field) => Object.prototype.hasOwnProperty.call(result, field),
      "cubePrices.root",
    );
  });

  it("keeps every contract point field somewhere across the point shapes it can occur in, or documents the drop", () => {
    // Same three shapes as the /sf-history/prices point test above.
    const payload = {
      itemId: 1001,
      cubeOrder: ["RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"],
      points: [
        { date: "2026-01-01T00:00:00Z", cubes: [1, 2, 3, null], closed: true },
        { date: "2026-01-02T00:00:00Z", cubes: [1, 2, 3, null], provisional: true, closed: true },
        { date: "2026-01-03T00:00:00Z", cubes: [1, 2, 3, null], provisional: true, closed: false, asOf: "2026-01-03T00:10:00Z" },
      ],
    };
    const result = normalizeCubePricesPayload(payload, 1001);
    const seen = new Set();
    result.points.forEach((point) => Object.keys(point).forEach((key) => seen.add(key)));
    assertContractFieldsSurvive(
      CONTRACT.cubePrices.point,
      INTENTIONALLY_DROPPED.cubePrices.point,
      (field) => seen.has(field),
      "cubePrices.point",
    );
  });
});

// IMPL_PLAN_SH40 accept criterion (n): the detector above must stay strict --
// if the server adds YET ANOTHER field to `latest.root` that is neither
// passed through by `normalizeLatestPayload` NOR added to
// INTENTIONALLY_DROPPED.latest.root, `assertContractFieldsSurvive` must fail
// loudly, not pass silently. This is a regression guard on the detector
// itself (not on any real field) -- proves the negative-test property this
// file exists for (SH-9/SH-16/SH-19) still holds after SH-40's fix, and
// would still hold the next time a real field is added and forgotten here.
describe("contract detector regression guard (accept criterion (n))", () => {
  it("fails when a contract field is neither normalized through nor listed in INTENTIONALLY_DROPPED", () => {
    const payload = {
      itemId: 1001,
      latestUpdatedAt: "2026-08-04T18:20:00Z",
      prices: [1, 2, null, 4],
      cubes: [1, null, null, null],
      cubeOrder: ["RED", "BLACK", "ADDITIONAL", "WHITE_ADDITIONAL"],
    };
    const result = normalizeLatestPayload(payload, 1001);
    const hypotheticalContractFields = ["itemId", "cubes", "cubeOrder", "totallyNewUndocumentedField"];
    expect(() =>
      assertContractFieldsSurvive(
        hypotheticalContractFields,
        INTENTIONALLY_DROPPED.latest.root,
        (field) => Object.prototype.hasOwnProperty.call(result, field),
        "latest.root (regression guard)",
      ),
    ).toThrow(/totallyNewUndocumentedField/);
  });
});

describe("contract: /sf-history/equipment", () => {
  const payload = {
    generatedAt: "2026-08-04T18:30:54Z",
    excluded: [{ itemId: 1113282, reason: "x" }],
    items: [{ itemId: 1001, itemName: "X", aliasItemIds: [1001], aliases: [{ itemId: 1001, itemName: "X" }], maxStar: 22 }],
  };

  it("keeps every contract root field, or documents the drop", () => {
    const result = normalizeEquipmentPayload(payload);
    assertContractFieldsSurvive(
      CONTRACT.equipment.root,
      INTENTIONALLY_DROPPED.equipment.root,
      (field) => Object.prototype.hasOwnProperty.call(result, field),
      "equipment.root",
    );
  });

  it("keeps every contract item field, or documents the drop", () => {
    const result = normalizeEquipmentPayload(payload);
    const item = result.items[0];
    assertContractFieldsSurvive(
      CONTRACT.equipment.item,
      INTENTIONALLY_DROPPED.equipment.item,
      (field) => Object.prototype.hasOwnProperty.call(item, field),
      "equipment.item",
    );
  });
});
