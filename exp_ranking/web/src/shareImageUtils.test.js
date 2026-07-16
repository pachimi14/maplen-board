import { describe, expect, it } from "vitest";
import { buildShareText, characterDetailUrl, safeShareFileName, xIntentUrl } from "./shareImageUtils.js";

const gainRankMaps = {
  daily: new Map([["c1", 13]]),
  weekly: new Map([["c1", 6]]),
  monthly: new Map([["c1", 5]]),
};

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

  it("builds an X share text with character summary and gain ranks", () => {
    expect(
      buildShareText(
        {
          id: "c1",
          name: "Benjapol",
          job: "Shadower",
          worldId: "Errai",
          level: 254,
          levelExpPercent: 17.866,
          rank: 8,
          dailyGain: 814_200_000_000,
          weeklyGain: 4_270_000_000_000,
          monthlyGain: 10_170_000_000_000,
        },
        "https://x",
        null,
        gainRankMaps,
      ),
    ).toBe(
      "My EXP Report — Benjapol\n" +
        "⭐ Shadower · Errai · Lv.254 17.866% · Rank #8\n" +
        "\n" +
        "📈 Daily +814.2B · No.13\n" +
        "📊 Weekly +4.27T · No.6\n" +
        "🌙 Monthly +10.17T · No.5\n" +
        "\n" +
        "https://x\n" +
        "#MapleStoryN #LulumiTools",
    );
  });

  it("encodes X intent text", () => {
    expect(xIntentUrl("A B\nhttps://x")).toContain("A%20B%0Ahttps%3A%2F%2Fx");
  });
});