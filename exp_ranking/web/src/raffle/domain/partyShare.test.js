import { describe, expect, it } from "vitest";
import { buildPartyShareUrl, decodePartyShare, encodePartyShare } from "./partyShare.js";

describe("raffle party sharing", () => {
  const party = {
    name: "Chaos Slime PT",
    members: [
      { assetKey: "CHARfixture001", displayName: "A" },
      { assetKey: "CHARfixture002", displayName: "B" },
    ],
    distributionRulesByBoss: {
      SLIME: {
        taxPercentByAssetKey: { CHARfixture001: "50" },
        sharePercentByAssetKey: { CHARfixture002: "100" },
        powerCrystalNesoRate: "1.25",
      },
    },
    carryoverByAssetKey: { CHARfixture001: "999" },
  };

  it("round-trips members and boss rules without carryover or private result data", () => {
    const token = encodePartyShare(party);
    const decoded = decodePartyShare(token);
    expect(decoded.ok).toBe(true);
    expect(decoded.party.name).toBe("Chaos Slime PT");
    expect(decoded.party.members.map((member) => member.displayName)).toEqual(["A", "B"]);
    expect(decoded.party.distributionRulesByBoss.SLIME).toEqual(party.distributionRulesByBoss.SLIME);
    expect(token).not.toContain("999");
  });

  it("builds a raffle URL and rejects malformed payloads", () => {
    const url = buildPartyShareUrl(party, { origin: "https://lulumi-tools.com", pathname: "/" });
    expect(url).toMatch(/^https:\/\/lulumi-tools\.com\/\?raffleParty=.+#\/raffle$/);
    expect(decodePartyShare("not-json").ok).toBe(false);
  });
});
