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
import { normalizeEquipmentPayload, normalizeLatestPayload, normalizePricesPayload } from "./sfHistorySource.js";

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
    root: ["itemId"],
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
  const payload = { itemId: 1001, latestUpdatedAt: "2026-08-04T18:20:00Z", prices: [1, 2, null, 4] };

  it("keeps every contract root field, or documents the drop", () => {
    const result = normalizeLatestPayload(payload, 1001);
    assertContractFieldsSurvive(
      CONTRACT.latest.root,
      INTENTIONALLY_DROPPED.latest.root,
      (field) => Object.prototype.hasOwnProperty.call(result, field),
      "latest.root",
    );
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
