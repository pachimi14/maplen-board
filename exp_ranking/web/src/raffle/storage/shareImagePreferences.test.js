import { describe, expect, it } from "vitest";
import { DEFAULT_SHARE_IMAGE_OPTIONS } from "../shareImage.js";
import { loadShareImagePreferences, saveShareImagePreferences } from "./shareImagePreferences.js";

function backend() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

describe("share image preferences", () => {
  it("uses the complete default set until the user customizes it", () => {
    expect(loadShareImagePreferences(backend())).toEqual(DEFAULT_SHARE_IMAGE_OPTIONS);
  });

  it("persists boolean choices and suppresses wallets when transfers are hidden", () => {
    const storage = backend();
    saveShareImagePreferences({ ...DEFAULT_SHARE_IMAGE_OPTIONS, showRuleDetails: false, showTransfers: false }, storage);
    expect(loadShareImagePreferences(storage)).toMatchObject({ showRuleDetails: false, showTransfers: false, showWallets: false });
  });
});
