import { describe, expect, it } from "vitest";
import { sortPartyMembers } from "./partyOrder.js";

function member(assetKey, displayName) {
  return { assetKey, displayName };
}

describe("sortPartyMembers", () => {
  it("orders by casefolded display name, Unicode code point descending", () => {
    const members = [member("CHAR1", "alice"), member("CHAR2", "Zeta"), member("CHAR3", "bob")];
    const sorted = sortPartyMembers(members);
    expect(sorted.map((entry) => entry.displayName)).toEqual(["Zeta", "bob", "alice"]);
  });

  it("produces the same order regardless of input order (order independence)", () => {
    const a = member("CHAR-A", "SHIVA");
    const b = member("CHAR-B", "pachimi");
    const c = member("CHAR-C", "Nova");
    const orderOne = sortPartyMembers([a, b, c]);
    const orderTwo = sortPartyMembers([c, a, b]);
    const orderThree = sortPartyMembers([b, c, a]);
    expect(orderOne.map((entry) => entry.assetKey)).toEqual(orderTwo.map((entry) => entry.assetKey));
    expect(orderOne.map((entry) => entry.assetKey)).toEqual(orderThree.map((entry) => entry.assetKey));
  });

  it("breaks ties on identical (casefolded) names by assetKey ascending", () => {
    const members = [member("CHAR-Z", "Nova"), member("CHAR-A", "nova"), member("CHAR-M", "NOVA")];
    const sorted = sortPartyMembers(members);
    expect(sorted.map((entry) => entry.assetKey)).toEqual(["CHAR-A", "CHAR-M", "CHAR-Z"]);
  });

  it("does not mutate the input array", () => {
    const members = [member("CHAR1", "alice"), member("CHAR2", "Zeta")];
    const copy = [...members];
    sortPartyMembers(members);
    expect(members).toEqual(copy);
  });

  it("handles non-array input defensively", () => {
    expect(sortPartyMembers(null)).toEqual([]);
    expect(sortPartyMembers(undefined)).toEqual([]);
  });

  it("does not use localeCompare-sensitive collation (plain code point order for ascii)", () => {
    // "Z" (0x5A) casefolds to "z" (0x7A); a purely lexicographic descending
    // comparison of ascii letters should read z > y > ... > a.
    const members = [member("C1", "apple"), member("C2", "banana"), member("C3", "cherry")];
    const sorted = sortPartyMembers(members);
    expect(sorted.map((entry) => entry.displayName)).toEqual(["cherry", "banana", "apple"]);
  });
});
