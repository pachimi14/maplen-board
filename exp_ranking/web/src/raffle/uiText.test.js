import { describe, expect, it } from "vitest";
import ja from "../i18n/locales/ja.json";
import en from "../i18n/locales/en.json";
import {
  describeProgressStage,
  describeRaffleCode,
  describeRaffleEntry,
  describeSettlementError,
  formatRaffleRoundLocal,
  formatRaffleRoundUtc,
  pcPortionAmount,
  sumTransferAmounts,
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
    for (const code of ["rateLimited", "client_rate_limited", "networkError", "aborted", "invalidResponse", "metadata_timeout", "ambiguous_party_cluster", "fixture_mode"]) {
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
});

describe("sumTransferAmounts", () => {
  it("sums decimal-string amounts with BigInt precision", () => {
    expect(sumTransferAmounts([{ amount: "280" }, { amount: "45" }])).toBe("325");
  });

  it("returns \"0\" for an empty or missing transfers array", () => {
    expect(sumTransferAmounts([])).toBe("0");
    expect(sumTransferAmounts(undefined)).toBe("0");
  });

  it("matches the settlement's own `transfers` total for a real calculateSettlement output", () => {
    const result = calculateSettlement({
      boss: "WILL",
      complete: true,
      historyMemberIds: ["a"],
      partyOrder: ["a", "b", "c"],
      include: { coin: false, equipment: false, bossNeso: true, powerCrystal: false, ascendantNeso: false },
      members: [
        { memberId: "a", bossNeso: "900", drops: [] },
        { memberId: "b", bossNeso: "0", drops: [] },
        { memberId: "c", bossNeso: "0", drops: [] },
      ],
    });
    expect(result.ok).toBe(true);
    const manualTotal = result.transfers.reduce((sum, transfer) => sum + BigInt(transfer.amount), 0n).toString();
    expect(sumTransferAmounts(result.transfers)).toBe(manualTotal);
    expect(result.transfers.length).toBeGreaterThan(0);
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
    expect(pcPortionAmount(result.members[0])).toBe("120");
    expect(pcPortionAmount(result.members[1])).toBeNull();
  });

  it("returns null for a zero/absent powerCrystalNeso", () => {
    expect(pcPortionAmount({ powerCrystalNeso: "0" })).toBeNull();
    expect(pcPortionAmount({})).toBeNull();
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
