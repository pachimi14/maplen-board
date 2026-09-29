const BOSSES = ["LUCID", "WILL", "SLIME"];
const ASSET_PATTERN = /^CHAR[A-Za-z0-9_-]{4,124}$/;
const PERCENT_PATTERN = /^(?:100(?:\.0{1,6})?|\d{1,2}(?:\.\d{1,6})?)$/;
const RATE_PATTERN = /^\d{1,30}(?:\.\d{1,18})?$/;
const MAX_TOKEN_LENGTH = 4096;

function base64UrlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(token) {
  const padded = token.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((token.length + 3) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export function encodePartyShare(party) {
  const members = Array.isArray(party?.members) ? party.members.slice(0, 6) : [];
  const payload = {
    v: 1,
    n: String(party?.name || "Raffle Party").slice(0, 80),
    m: members.map((member) => [member.assetKey, String(member.displayName || member.assetKey).slice(0, 80)]),
    r: {},
  };
  const memberAssets = new Set(members.map((member) => member.assetKey));
  for (const boss of BOSSES) {
    const rules = party?.distributionRulesByBoss?.[boss];
    if (!rules) continue;
    const tax = Object.entries(rules.taxPercentByAssetKey || {}).filter(([assetKey, value]) => memberAssets.has(assetKey) && PERCENT_PATTERN.test(String(value)) && Number(value) > 0);
    const share = Object.entries(rules.sharePercentByAssetKey || {}).filter(([assetKey, value]) => memberAssets.has(assetKey) && PERCENT_PATTERN.test(String(value)));
    const rate = String(rules.powerCrystalNesoRate ?? "").trim();
    if (tax.length || share.length || (RATE_PATTERN.test(rate) && Number(rate) > 0)) payload.r[boss] = { t: tax, s: share, ...(RATE_PATTERN.test(rate) && Number(rate) > 0 ? { p: rate } : {}) };
  }
  return base64UrlEncode(JSON.stringify(payload));
}

export function decodePartyShare(token) {
  if (typeof token !== "string" || !token || token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) return { ok: false };
  try {
    const payload = JSON.parse(base64UrlDecode(token));
    if (payload?.v !== 1 || !Array.isArray(payload.m) || payload.m.length < 1 || payload.m.length > 6) return { ok: false };
    const seen = new Set();
    const members = payload.m.map((entry) => {
      const assetKey = Array.isArray(entry) ? entry[0] : "";
      if (!ASSET_PATTERN.test(assetKey) || seen.has(assetKey)) throw new Error("invalid member");
      seen.add(assetKey);
      return { assetKey, displayName: String(entry[1] || assetKey).slice(0, 80), worldId: "", level: null, jobName: "", imageUrl: "" };
    });
    const distributionRulesByBoss = {};
    for (const boss of BOSSES) {
      const raw = payload.r?.[boss];
      if (!raw) continue;
      const taxPercentByAssetKey = {};
      const sharePercentByAssetKey = {};
      const rate = String(raw.p ?? "").trim();
      for (const [assetKey, value] of Array.isArray(raw.t) ? raw.t : []) {
        if (seen.has(assetKey) && PERCENT_PATTERN.test(String(value)) && Number(value) > 0) taxPercentByAssetKey[assetKey] = String(value);
      }
      for (const [assetKey, value] of Array.isArray(raw.s) ? raw.s : []) {
        if (seen.has(assetKey) && PERCENT_PATTERN.test(String(value))) sharePercentByAssetKey[assetKey] = String(value);
      }
      if (Object.keys(taxPercentByAssetKey).length || Object.keys(sharePercentByAssetKey).length || (RATE_PATTERN.test(rate) && Number(rate) > 0)) {
        distributionRulesByBoss[boss] = { taxPercentByAssetKey, sharePercentByAssetKey, ...(RATE_PATTERN.test(rate) && Number(rate) > 0 ? { powerCrystalNesoRate: rate } : {}) };
      }
    }
    return {
      ok: true,
      party: {
        name: String(payload.n || "Shared Raffle Party").slice(0, 80),
        members,
        distributionRulesByBoss,
      },
    };
  } catch {
    return { ok: false };
  }
}

export function buildPartyShareUrl(party, locationLike = window.location) {
  const url = new URL(locationLike.origin + locationLike.pathname);
  url.searchParams.set("raffleParty", encodePartyShare(party));
  url.hash = "/raffle";
  return url.toString();
}
