import { describe, expect, it } from "vitest";
import { RAFFLE_MANUAL_ENTRY_KEY, loadManualEntries, saveManualEntries, sanitizeManualBosses } from "./manualEntryStorage.js";

function backend(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

const ROUND = "2026-11-19T00:00:00Z";
const NEXT_ROUND = "2026-11-26T00:00:00Z";
const T0 = Date.parse(ROUND) + 1000;

function fullBosses() {
  return {
    LUCID: {
      difficulty: "NORMAL",
      include: { coin: false, equipment: true, ftItem: false, box: true, bossNeso: true, powerCrystal: false, ascendantNeso: true },
      entriesByAssetKey: {
        CHARa: { bossNeso: "1000", ascendantNeso: "2,000", powerCrystalAmount: "110", coinQuantity: "2", coinSaleNeso: "12a", equipment: [{ rowId: "e1", name: "Arcane Hat", saleNeso: "5" }], box: [{ rowId: "b1", name: "", saleNeso: "" }] },
      },
    },
    WILL: {
      difficulty: "HARD",
      include: { coin: true, equipment: true, ftItem: true, box: true, bossNeso: true, powerCrystal: true, ascendantNeso: true },
      entriesByAssetKey: { CHARb: { ftItemQuantity: "1", ftItemSaleNeso: "300" } },
    },
    SLIME: { difficulty: "CHAOS", include: { box: false }, entriesByAssetKey: { CHARa: { box: [{ rowId: "x", name: "Chaos Ring Box", saleNeso: "9" }] } } },
  };
}

describe("manual entry storage (LULU-145)", () => {
  it("restores every field after save -> reload, for the same round and party (assetKey order ignored)", () => {
    const storage = backend();
    const saved = saveManualEntries(ROUND, ["CHARb", "CHARa"], fullBosses(), { backend: storage, now: T0 });
    expect(saved).toEqual({ ok: true, code: "ok", savedAt: T0 });
    const loaded = loadManualEntries(ROUND, ["CHARa", "CHARb"], { backend: storage, now: T0 + 60_000 });
    expect(loaded.ok).toBe(true);
    expect(loaded.bosses).toEqual(fullBosses());
    const raw = JSON.parse(storage.values.get(RAFFLE_MANUAL_ENTRY_KEY));
    expect(Object.keys(raw)).toEqual([ROUND + "|CHARa,CHARb"]);
    expect(raw[ROUND + "|CHARa,CHARb"].expiresAt).toBe(Date.parse(NEXT_ROUND));
  });

  it("is empty for the next round, at the Thursday reset, and for another party", () => {
    const storage = backend();
    saveManualEntries(ROUND, ["CHARa"], fullBosses(), { backend: storage, now: T0 });
    expect(loadManualEntries(NEXT_ROUND, ["CHARa"], { backend: storage, now: Date.parse(NEXT_ROUND) + 1 }).bosses).toEqual({});
    expect(loadManualEntries(ROUND, ["CHARa"], { backend: storage, now: Date.parse(NEXT_ROUND) }).bosses).toEqual({});
    expect(loadManualEntries(ROUND, ["CHARa", "CHARz"], { backend: storage, now: T0 + 1 }).bosses).toEqual({});
  });

  it("never throws on broken JSON / wrong shapes and starts empty", () => {
    for (const raw of ["{not json", "[]", "null", JSON.stringify({ [ROUND + "|CHARa"]: { savedAt: "x", expiresAt: 1 } })]) {
      const storage = backend({ [RAFFLE_MANUAL_ENTRY_KEY]: raw });
      expect(() => loadManualEntries(ROUND, ["CHARa"], { backend: storage, now: T0 })).not.toThrow();
      expect(loadManualEntries(ROUND, ["CHARa"], { backend: storage, now: T0 }).bosses).toEqual({});
      expect(saveManualEntries(ROUND, ["CHARa"], fullBosses(), { backend: storage, now: T0 }).ok).toBe(true);
    }
    const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
    expect(loadManualEntries(ROUND, ["CHARa"], { backend: throwing, now: T0 }).bosses).toEqual({});
    expect(saveManualEntries(ROUND, ["CHARa"], fullBosses(), { backend: throwing, now: T0 })).toEqual({ ok: false, code: "writeFailed" });
  });

  it("drops malformed fields but keeps the valid ones", () => {
    expect(sanitizeManualBosses({
      LUCID: { difficulty: "CHAOS", include: { coin: "yes", box: false }, entriesByAssetKey: { CHARa: { bossNeso: 5, ascendantNeso: "7", equipment: [{ name: "no id" }, { rowId: "r", name: 3, saleNeso: "1" }] }, CHARb: "bad" } },
      SLIME: "bad",
      OTHER: { difficulty: "HARD" },
    })).toEqual({
      LUCID: { include: { box: false }, entriesByAssetKey: { CHARa: { ascendantNeso: "7", equipment: [{ rowId: "r", name: "", saleNeso: "1" }] }, CHARb: {} } },
    });
  });

  it("keeps at most 12 entries: saving the 13th drops the oldest, and expired entries are swept", () => {
    const storage = backend();
    for (let index = 0; index < 12; index += 1) {
      saveManualEntries(ROUND, ["CHAR" + index], {}, { backend: storage, now: T0 + index });
    }
    expect(Object.keys(JSON.parse(storage.values.get(RAFFLE_MANUAL_ENTRY_KEY)))).toHaveLength(12);
    saveManualEntries(ROUND, ["CHAR12"], {}, { backend: storage, now: T0 + 12 });
    const keys = Object.keys(JSON.parse(storage.values.get(RAFFLE_MANUAL_ENTRY_KEY)));
    expect(keys).toHaveLength(12);
    expect(keys).not.toContain(ROUND + "|CHAR0");
    expect(keys).toContain(ROUND + "|CHAR1");
    expect(keys).toContain(ROUND + "|CHAR12");
    expect(loadManualEntries(ROUND, ["CHAR0"], { backend: storage, now: T0 + 13 }).ok).toBe(false);

    saveManualEntries(NEXT_ROUND, ["CHARn"], {}, { backend: storage, now: Date.parse(NEXT_ROUND) + 1 });
    expect(Object.keys(JSON.parse(storage.values.get(RAFFLE_MANUAL_ENTRY_KEY)))).toEqual([NEXT_ROUND + "|CHARn"]);
  });

  it("refuses to save for an already-expired round", () => {
    expect(saveManualEntries(ROUND, ["CHARa"], {}, { backend: backend(), now: Date.parse(NEXT_ROUND) })).toEqual({ ok: false, code: "expiredRound" });
  });
});
