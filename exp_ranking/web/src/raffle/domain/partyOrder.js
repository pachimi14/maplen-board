// Normalizes PT member display/processing order so that the same set of
// members always yields the same order regardless of how they were typed in.
// This matters because settlement distributes the remainder (+1 NESO) to the
// first N members in order, and the transfer pairing walks payers/receivers
// in order — both depend on member order.
//
// Order: casefolded (toLowerCase) display name, Unicode code point
// descending; ties broken by assetKey ascending. `localeCompare` is
// intentionally not used so the result is identical across devices/locales.

function toCodePointArray(text) {
  return Array.from(String(text ?? ""));
}

// Compares two casefolded strings by Unicode code point, descending.
// Uses Array.from (code-point aware, unlike raw UTF-16 indexing) so
// surrogate-pair characters compare correctly.
function compareCodePointsDescending(a, b) {
  const aPoints = toCodePointArray(a);
  const bPoints = toCodePointArray(b);
  const length = Math.min(aPoints.length, bPoints.length);
  for (let index = 0; index < length; index += 1) {
    const aCode = aPoints[index].codePointAt(0);
    const bCode = bPoints[index].codePointAt(0);
    if (aCode !== bCode) return bCode - aCode;
  }
  return bPoints.length - aPoints.length;
}

export function sortPartyMembers(members) {
  const list = Array.isArray(members) ? members : [];
  return list
    .map((member, index) => ({ member, index }))
    .sort((a, b) => {
      const nameCompare = compareCodePointsDescending(
        String(a.member?.displayName ?? "").toLowerCase(),
        String(b.member?.displayName ?? "").toLowerCase(),
      );
      if (nameCompare !== 0) return nameCompare;
      const assetKeyA = String(a.member?.assetKey ?? "");
      const assetKeyB = String(b.member?.assetKey ?? "");
      if (assetKeyA !== assetKeyB) return assetKeyA < assetKeyB ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.member);
}
