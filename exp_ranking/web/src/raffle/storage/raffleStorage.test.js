import { describe, expect, it } from "vitest";
import { RAFFLE_STORAGE_KEY, assetKeyFromHistoryKey, createEmptyRaffleState, createParty, loadRaffleState, normalizeRaffleState, saveRaffleState } from "./raffleStorage.js";

function memoryBackend(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, value),
    value: (key) => data.get(key),
  };
}

describe("raffle storage", () => {
  it("stores only party identity and members", () => {
    const party = createParty("p1", "Party");
    party.members.push({ assetKey: "CHARfixture001", displayName: "A", worldId: "w1", level: 253, jobName: "Evan", imageUrl: "https://example.test/a.png" });
    party.carryoverEnabled = true;
    party.carryoverByAssetKey.CHARfixture001 = "-25";
    const backend = memoryBackend();
    expect(saveRaffleState({ ...createEmptyRaffleState(), activePartyId: "p1", parties: [party] }, backend).ok).toBe(true);
    const raw = backend.value(RAFFLE_STORAGE_KEY);
    expect(raw).toContain("CHARfixture001");
    expect(raw).not.toContain("wallet");
    expect(raw).not.toContain("saleNeso");
    expect(raw).toContain('"jobName":"Evan"');
    expect(raw).toContain('"carryoverEnabled":true');
    expect(raw).toContain('"CHARfixture001":"-25"');
  });

  it("does not overwrite corrupt data while loading", () => {
    const backend = memoryBackend({ [RAFFLE_STORAGE_KEY]: "{" });
    expect(loadRaffleState(backend)).toMatchObject({ ok: false, code: "corrupt" });
    expect(backend.value(RAFFLE_STORAGE_KEY)).toBe("{");
  });

  it("rejects unknown versions and caps parties and members", () => {
    expect(normalizeRaffleState({ version: 99 }).code).toBe("unsupportedVersion");
    const value = { version: 1, activePartyId: "p0", parties: Array.from({ length: 12 }, (_, index) => ({ id: "p" + index, members: Array.from({ length: 8 }, (__, memberIndex) => ({ assetKey: "CHARxx" + index + "x" + memberIndex, displayName: "member" })) })) };
    const result = normalizeRaffleState(value);
    expect(result.state.parties).toHaveLength(10);
    expect(result.state.parties[0].members).toHaveLength(6);
  });

  it("derives assetKey only from canonical history keys", () => {
    expect(assetKeyFromHistoryKey("asset:CHARabc")).toBe("CHARabc");
    expect(assetKeyFromHistoryKey("name:abc")).toBe("");
  });
  it("loads legacy parties with carryover disabled and normalizes signed values", () => {
    const legacy = normalizeRaffleState({
      version: 1,
      activePartyId: "p1",
      parties: [{ id: "p1", name: "Legacy", members: [{ assetKey: "CHARfixture001", displayName: "A" }] }],
    });
    expect(legacy.state.parties[0]).toMatchObject({ carryoverEnabled: false, carryoverByAssetKey: { CHARfixture001: "0" } });

    const normalized = normalizeRaffleState({
      version: 1,
      activePartyId: "p1",
      parties: [{
        id: "p1",
        members: [{ assetKey: "CHARfixture001" }, { assetKey: "CHARfixture002" }],
        carryoverEnabled: true,
        carryoverByAssetKey: { CHARfixture001: "-00025", CHARfixture002: "+00025", ignored: "99" },
      }],
    });
    expect(normalized.state.parties[0]).toMatchObject({
      carryoverEnabled: true,
      carryoverByAssetKey: { CHARfixture001: "-25", CHARfixture002: "25" },
    });
  });
});