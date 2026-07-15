import { describe, expect, it } from "vitest";
import { buildShareText, characterDetailUrl, safeShareFileName, xIntentUrl } from "./shareImageUtils.js";

const t = (key, params) => `${params.name} Lv.${params.level} ${params.percent}%`;

describe("share image utilities", () => {
  it("builds a character detail hash URL", () => {
    const url = characterDetailUrl(
      { historyKey: "asset key/with space" },
      { origin: "https://lulumi-tools.com", pathname: "/" },
    );
    expect(url).toBe("https://lulumi-tools.com/#/character/asset%20key%2Fwith%20space");
  });

  it("sanitizes share image filenames", () => {
    const name = safeShareFileName({ name: "bad:/ name*" }, new Date("2026-07-16T00:00:00Z"));
    expect(name).toBe("lulumi-tools_bad_name_2026-07-16.png");
  });

  it("builds share text with detail URL", () => {
    expect(buildShareText({ name: "Benjapol", level: 254, levelExpPercent: 17.866 }, "https://x", t)).toBe(
      "Benjapol Lv.254 17.866%\nhttps://x",
    );
  });

  it("encodes X intent text", () => {
    expect(xIntentUrl("A B\nhttps://x")).toContain("A%20B%0Ahttps%3A%2F%2Fx");
  });
});
