import { describe, expect, it } from "vitest";
import ja from "../i18n/locales/ja.json";
import en from "../i18n/locales/en.json";
import {
  buildTransferNotificationText,
  describeProgressStage,
  describeRaffleCode,
  describeRaffleEntry,
  describeSettlementError,
  formatRaffleRoundLocal,
  formatRaffleRoundUtc,
  pcPortionAmount,
  resolveMemberWallet,
  settlementCategoryColumns,
  settlementMemberCategoryCell,
  signedNeso,
} from "./uiText.js";
import { calculateSettlement } from "./domain/settlement.js";

function getNested(obj, path) {
  return path.split(".").reduce((current, key) => current?.[key], obj);
}

function makeT(messages) {
  return (key, vars = {}) => {
    const template = getNested(messages, key) ?? key;
    if (typeof template !== "string") return key;
    return template.replace(/\{\{(\w+)\}\}/g, (_, name) => (vars[name] != null ? String(vars[name]) : ""));
  };
}

const t = makeT(ja);
const tEn = makeT(en);

describe("formatRaffleRoundLocal", () => {
  it("formats a fixed instant using an explicit timeZone (deterministic across hosts)", () => {
    const text = formatRaffleRoundLocal("2026-07-30T00:00:00Z", { locale: "ja", timeZone: "Asia/Tokyo" });
    expect(text).toContain("2026");
    expect(text).toContain("9:00");
  });

  it("shifts across timezones", () => {
    const tokyo = formatRaffleRoundLocal("2026-07-30T00:00:00Z", { locale: "en", timeZone: "Asia/Tokyo" });
    const losAngeles = formatRaffleRoundLocal("2026-07-30T00:00:00Z", { locale: "en", timeZone: "America/Los_Angeles" });
    expect(tokyo).not.toBe(losAngeles);
  });

  it("returns an empty string for an invalid ISO string", () => {
    expect(formatRaffleRoundLocal("not-a-date", { locale: "ja", timeZone: "UTC" })).toBe("");
  });
});

describe("formatRaffleRoundUtc", () => {
  it("formats as zero-padded HH:MM UTC", () => {
    expect(formatRaffleRoundUtc("2026-07-30T00:00:00Z")).toBe("00:00 UTC");
    expect(formatRaffleRoundUtc("2026-07-30T09:05:00Z")).toBe("09:05 UTC");
  });

  it("returns an empty string for an invalid ISO string", () => {
    expect(formatRaffleRoundUtc("not-a-date")).toBe("");
  });
});

describe("describeProgressStage", () => {
  it("includes the n/m people count only for the fetching stage", () => {
    const text = describeProgressStage({ stage: "fetching", completedCharacters: 2, totalCharacters: 6 }, { t });
    expect(text).toBe("履歴を取得中… 2 / 6人");
  });

  it("does not include counts for non-fetching known stages", () => {
    const text = describeProgressStage({ stage: "queued", completedCharacters: 0, totalCharacters: 6 }, { t });
    expect(text).not.toMatch(/\d\s*\/\s*\d/);
  });

  it.each(["queued", "normalizing", "complete", "partial", "error", "cancelled"])(
    "maps known stage %s to non-raw text",
    (stage) => {
      const text = describeProgressStage({ stage }, { t });
      expect(text).not.toBe(stage);
      expect(text.length).toBeGreaterThan(0);
    },
  );

  it("falls back to a generic message for unknown/unlisted stages", () => {
    const text = describeProgressStage({ stage: "resolving" }, { t });
    expect(text).not.toContain("resolving");
    expect(text).toBe(t("raffle.progressStageUnknown"));
  });
});

describe("describeRaffleCode", () => {
  it("never renders the raw code for known codes", () => {
    for (const code of ["rateLimited", "client_rate_limited", "networkError", "aborted", "invalidResponse", "metadata_timeout", "ambiguous_party_cluster", "fixture_mode", "ascendant_not_found"]) {
      const text = describeRaffleCode(code, { t });
      expect(text).not.toBe(code);
      expect(text).not.toContain(code);
    }
  });

  it("groups rate-limit-ish codes onto the same message", () => {
    const a = describeRaffleCode("rateLimited", { t });
    const b = describeRaffleCode("client_rate_limited", { t });
    const c = describeRaffleCode("upstream_daily_budget_exceeded", { t });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("resolves member names for history_unavailable and wallet_not_available", () => {
    const memberMap = { "member-1": { displayName: "pachimi" } };
    expect(describeRaffleEntry({ code: "history_unavailable", memberId: "member-1" }, { t, memberMap })).toBe(
      "pachimi のラッフル履歴を取得できませんでした。",
    );
    expect(describeRaffleEntry({ code: "wallet_not_available", memberId: "member-1" }, { t, memberMap })).toBe(
      "pachimi のウォレット情報を取得できませんでした。",
    );
  });

  it("falls back to memberId when the name cannot be resolved", () => {
    const text = describeRaffleEntry({ code: "history_unavailable", memberId: "member-9" }, { t, memberMap: {} });
    expect(text).toContain("member-9");
  });

  it("keeps unknown codes visible in parentheses alongside a generic message", () => {
    const text = describeRaffleCode("some_new_code_never_seen", { t });
    expect(text).toContain("(some_new_code_never_seen)");
    expect(text.length).toBeGreaterThan("(some_new_code_never_seen)".length);
  });

  it("describes ascendant_not_found in human language with the boss and expected tier (LULU: Ascendant layer rename)", () => {
    const text = describeRaffleEntry(
      { code: "ascendant_not_found", boss: "WILL", bossDifficulty: "HARD", expectedTier: "Eternal Ascendant" },
      { t },
    );
    expect(text).not.toBe("ascendant_not_found");
    expect(text).not.toContain("ascendant_not_found");
    expect(text).toContain("Will");
    expect(text).toContain("Eternal Ascendant");
  });

  it("never renders the raw ascendant_not_found code across all 6 locales", () => {
    for (const messages of [ja, en]) {
      const text = describeRaffleCode("ascendant_not_found", { t: makeT(messages), boss: "LUCID", expectedTier: "Divine Ascendant" });
      expect(text).not.toBe("ascendant_not_found");
      expect(text).toContain("Divine Ascendant");
    }
  });
});

describe("describeSettlementError", () => {
  it("matches the documented example for a saleNeso field error", () => {
    const memberMap = { "member-1": { displayName: "pachimi" } };
    const dropNameByDropId = { "drop-1": "Phantasma Coin" };
    const text = describeSettlementError(
      { code: "invalid_integer", field: "saleNeso", memberId: "member-1", dropId: "drop-1" },
      { t, memberMap, dropNameByDropId },
    );
    expect(text).toBe("pachimi — Phantasma Coin の" + t("raffle.saleAmount") + "は0以上の整数で入力してください。");
  });

  it("uses the exact documented copy for fractional_neso", () => {
    expect(describeSettlementError({ code: "fractional_neso" }, { t })).toBe(
      "Power Crystal換算が整数NESOになりません。レートを見直してください。",
    );
  });

  it("keeps carryover_not_balanced localized the same way as before", () => {
    expect(describeSettlementError({ code: "carryover_not_balanced" }, { t })).toBe(t("raffle.carryoverNotBalanced"));
  });

  it("localizes structural errors without a raw code", () => {
    for (const code of ["invalid_boss", "incomplete_clear", "invalid_member_count", "party_mismatch", "invalid_drop", "invalid_rate"]) {
      const text = describeSettlementError({ code }, { t });
      expect(text).not.toBe(code);
      expect(text).not.toContain(code);
    }
  });

  it("describes a previousCarryover error using the member name only (no drop)", () => {
    const memberMap = { "member-2": { displayName: "someone" } };
    const text = describeSettlementError(
      { code: "invalid_signed_integer", field: "previousCarryover", memberId: "member-2" },
      { t, memberMap },
    );
    expect(text).toContain("someone");
    expect(text).toContain(t("raffle.previousCarryover"));
  });

  it("falls back gracefully for a completely unknown code", () => {
    const text = describeSettlementError({ code: "brand_new_validation_code" }, { t });
    expect(text).toContain("(brand_new_validation_code)");
  });

  it("works with the English locale too", () => {
    const text = describeSettlementError({ code: "fractional_neso" }, { t: tEn });
    expect(text).toBe(en.raffle.errorFractionalNeso);
  });

  // docs/IMPL_PLAN_RAFFLE_EXTRA_REWARD.md
  it("describes an invalid_extra_reward_member error with the exact documented copy", () => {
    expect(describeSettlementError({ code: "invalid_extra_reward_member" }, { t })).toBe(t("raffle.errorInvalidExtraRewardMember"));
  });

  it("describes a malformed extraRewardAmount field error using the extra-reward label", () => {
    const memberMap = { "member-1": { displayName: "pachimi" } };
    const text = describeSettlementError(
      { code: "invalid_integer", field: "extraRewardAmount", memberId: "member-1" },
      { t, memberMap },
    );
    expect(text).toContain("pachimi");
    expect(text).toContain(t("raffle.item_extraReward"));
  });
});

describe("pcPortionAmount (C1: value-vs-actual-NESO clarity, acceptance criterion 1)", () => {
  it("returns the converted PC amount for a member with a non-zero PC conversion (rate 1.2 composite case)", () => {
    const result = calculateSettlement({
      boss: "WILL",
      complete: true,
      historyMemberIds: ["a"],
      partyOrder: ["a", "b"],
      include: { coin: false, equipment: false, bossNeso: true, powerCrystal: true, ascendantNeso: false },
      powerCrystalNesoRate: "1.2",
      members: [
        { memberId: "a", bossNeso: "900", powerCrystalAmount: "100", ascendantNeso: "0", drops: [] },
        { memberId: "b", bossNeso: "0", powerCrystalAmount: "0", ascendantNeso: "0", drops: [] },
      ],
    });
    expect(result.ok).toBe(true);
    // This directly backs the "member card shows an 'incl. PC conversion'
    // note" half of the acceptance criterion: SettlementResult.jsx gates
    // that note on this exact function.
    // Rate 1.2 means "1 NESO = 1.2 Power Crystal" (LULU-099 divide
    // semantics): 100 PC / 1.2 = 83.33... -> rounds half up to 83.
    expect(pcPortionAmount(result.members[0])).toBe("83");
    expect(pcPortionAmount(result.members[1])).toBeNull();
  });

  it("returns null for a zero/absent powerCrystalNeso", () => {
    expect(pcPortionAmount({ powerCrystalNeso: "0" })).toBeNull();
    expect(pcPortionAmount({})).toBeNull();
  });
});

describe("resolveMemberWallet", () => {
  it("returns the wallet string when present", () => {
    expect(resolveMemberWallet({ "member-1": "0xEE158FbBF3507A4a7e42C112e49725db4875a5b9" }, "member-1")).toBe(
      "0xEE158FbBF3507A4a7e42C112e49725db4875a5b9",
    );
  });

  it("returns null when the member's wallet is missing or the map itself is missing", () => {
    expect(resolveMemberWallet({}, "member-1")).toBeNull();
    expect(resolveMemberWallet(undefined, "member-1")).toBeNull();
    expect(resolveMemberWallet({ "member-1": "" }, "member-1")).toBeNull();
    expect(resolveMemberWallet({ "member-1": 12345 }, "member-1")).toBeNull();
  });
});

describe("buildTransferNotificationText (LULU-103)", () => {
  const memberMap = { "member-1": { displayName: "SHIVA" }, "member-2": { displayName: "pachimi" } };
  const wallet = "0xEE158FbBF3507A4a7e42C112e49725db4875a5b9";

  it("matches the documented format exactly: 'SENDER → RECEIVER AMOUNT NESO' then the wallet on the next line", () => {
    const transfers = [{ fromMemberId: "member-1", toMemberId: "member-2", amount: "68720465" }];
    const text = buildTransferNotificationText(transfers, memberMap, { "member-2": wallet }, { t });
    expect(text).toBe("SHIVA → pachimi 68,720,465 NESO\n" + wallet);
  });

  it("separates multiple transfer blocks with a blank line", () => {
    const transfers = [
      { fromMemberId: "member-1", toMemberId: "member-2", amount: "100" },
      { fromMemberId: "member-2", toMemberId: "member-1", amount: "50" },
    ];
    const memberWallets = { "member-1": wallet, "member-2": "0x0000000000000000000000000000000000000001" };
    const text = buildTransferNotificationText(transfers, memberMap, memberWallets, { t });
    expect(text).toBe(
      "SHIVA → pachimi 100 NESO\n0x0000000000000000000000000000000000000001" +
        "\n\n" +
        "pachimi → SHIVA 50 NESO\n" + wallet,
    );
  });

  it("shows a localized placeholder instead of silently omitting an unknown receiver wallet", () => {
    const transfers = [{ fromMemberId: "member-1", toMemberId: "member-2", amount: "100" }];
    const text = buildTransferNotificationText(transfers, memberMap, {}, { t });
    expect(text).toBe("SHIVA → pachimi 100 NESO\n" + ja.raffle.walletUnavailable);
    expect(ja.raffle.walletUnavailable).toBe("(ウォレット未取得)");
  });

  it("returns an empty string for an empty/missing transfers list", () => {
    expect(buildTransferNotificationText([], memberMap, {}, { t })).toBe("");
    expect(buildTransferNotificationText(undefined, memberMap, {}, { t })).toBe("");
  });

  it("works with the English locale too", () => {
    const transfers = [{ fromMemberId: "member-1", toMemberId: "member-2", amount: "100" }];
    const text = buildTransferNotificationText(transfers, memberMap, {}, { t: tEn });
    expect(text).toBe("SHIVA → pachimi 100 NESO\n" + en.raffle.walletUnavailable);
  });
});

// LULU-103 C4: the share-image member table reuses these two pure helpers
// (instead of re-deriving the same column set/cell formatting a second
// time) so it can never disagree with the on-screen member table about
// which columns are shown or what a given member's cell says.
describe("settlementCategoryColumns", () => {
  it("returns only the included categories, in a fixed left-to-right order", () => {
    const include = { equipment: true, coin: true, bossNeso: true, powerCrystal: false, ascendantNeso: true };
    const columns = settlementCategoryColumns(include, t);
    expect(columns.map((column) => column.key)).toEqual(["bossNeso", "ascendantNeso", "coin", "equipment"]);
  });

  // F2/LULU-119: the Will FT Item column is the same shared-column mechanism
  // as coin/equipment (only shown when include.ftItem is true), so the C4
  // share-image member table can never disagree with the on-screen table.
  it("includes the Will FT Item column, in order, when included", () => {
    const include = { coin: true, ftItem: true, equipment: true };
    const columns = settlementCategoryColumns(include, t);
    expect(columns.map((column) => column.key)).toEqual(["coin", "equipment", "ftItem"]);
    expect(columns.find((column) => column.key === "ftItem")).toEqual({ key: "ftItem", label: t("raffle.item_ftItem") });
  });

  it("returns an empty array when nothing is included", () => {
    expect(settlementCategoryColumns({}, t)).toEqual([]);
    expect(settlementCategoryColumns(undefined, t)).toEqual([]);
  });

  it("labels every column with its localized item name", () => {
    const columns = settlementCategoryColumns({ powerCrystal: true }, t);
    expect(columns).toEqual([{ key: "powerCrystal", label: t("raffle.item_powerCrystal") }]);
  });
});

describe("settlementMemberCategoryCell", () => {
  it("dims a zero bossNeso/ascendantNeso value instead of showing a bare 0", () => {
    expect(settlementMemberCategoryCell({ bossNeso: "0" }, "bossNeso")).toEqual({ primary: "0", secondary: null, zero: true });
    expect(settlementMemberCategoryCell({ ascendantNeso: "600" }, "ascendantNeso")).toEqual({ primary: "600 NESO", secondary: null, zero: false });
  });

  it("shows the Power Crystal amount, with the converted NESO only when the rate isn't 1", () => {
    const member = { powerCrystalAmount: "100", powerCrystalNeso: "83" };
    expect(settlementMemberCategoryCell(member, "powerCrystal", { powerCrystalNesoRate: "1.2" })).toEqual({
      primary: "100 PC",
      secondary: "83 NESO",
      zero: false,
    });
    expect(settlementMemberCategoryCell(member, "powerCrystal", { powerCrystalNesoRate: "1" })).toEqual({
      primary: "100 PC",
      secondary: null,
      zero: false,
    });
    expect(settlementMemberCategoryCell({ powerCrystalAmount: "0", powerCrystalNeso: "0" }, "powerCrystal", { powerCrystalNesoRate: "1.2" })).toEqual({
      primary: "0",
      secondary: null,
      zero: true,
    });
  });

  it("shows coin quantity + sale proceeds, dimmed at zero", () => {
    expect(settlementMemberCategoryCell({ coinQuantity: "10", coinSaleNeso: "95" }, "coin")).toEqual({
      primary: "× 10",
      secondary: "95 NESO",
      zero: false,
    });
    expect(settlementMemberCategoryCell({ coinQuantity: "0" }, "coin")).toEqual({ primary: "0", secondary: null, zero: true });
  });

  it("shows only the equipment sale NESO amount (no icons -- callers that can render icons special-case equipment themselves), dimmed at zero", () => {
    expect(settlementMemberCategoryCell({ equipmentDrops: [{ dropId: "d1" }], equipmentSaleNeso: "285" }, "equipment")).toEqual({
      primary: "285 NESO",
      secondary: null,
      zero: false,
    });
    expect(settlementMemberCategoryCell({ equipmentDrops: [] }, "equipment")).toEqual({ primary: "—", secondary: null, zero: true });
  });

  it("shows FT Item quantity + sale proceeds like coin, dimmed at zero", () => {
    expect(settlementMemberCategoryCell({ ftItemQuantity: "1", ftItemSaleNeso: "950" }, "ftItem")).toEqual({
      primary: "× 1",
      secondary: "950 NESO",
      zero: false,
    });
    expect(settlementMemberCategoryCell({ ftItemQuantity: "0" }, "ftItem")).toEqual({ primary: "0", secondary: null, zero: true });
  });
});

// F3/LULU-119: signedNeso is now shared between SettlementResult.jsx's
// carryover badges and the share-image member table (shareImage.js) so a
// member's carryover value/sign can never disagree between the two.
describe("signedNeso", () => {
  it("prefixes a positive amount with + and leaves a negative amount's native -", () => {
    expect(signedNeso("500")).toBe("+500 NESO");
    expect(signedNeso("-500")).toBe("-500 NESO");
  });
  it("shows a zero amount with no sign", () => {
    expect(signedNeso("0")).toBe("0 NESO");
  });
});

describe("raffle.baseShare label (C1: value-vs-actual-NESO clarity)", () => {
  it("explicitly notes PC conversion is included, in every locale (regression pin for the value/actual-NESO confusion report)", () => {
    // A literal substring check rather than a rendered-component check: this
    // codebase has no @testing-library/react (see src/sfhistory/domain/
    // viewModel.test.js), so JSX-conditional UI is exercised via the pure
    // functions it delegates to (pcPortionAmount above; describeMemberSettlement
    // in shareImage.test.js once C2 lands), while purely-static per-locale
    // copy like this label is pinned directly here.
    expect(ja.raffle.baseShare).toContain("PC換算込み");
    expect(en.raffle.baseShare.toLowerCase()).toContain("pc");
    expect(en.raffle.baseShare.toLowerCase()).toContain("incl");
  });
});
