const ASSET_KEY_PATTERN = /^CHAR[A-Za-z0-9_-]{4,124}$/;

export function parseNavigatorCharacterUrl(value) {
  const input = String(value ?? "").trim();
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.hostname !== "msu.io") {
      return { ok: false, code: "invalid_navigator_url" };
    }
    const match = /^\/navigator\/character\/(CHAR[A-Za-z0-9_-]{4,124})\/?$/.exec(url.pathname);
    if (!match || !ASSET_KEY_PATTERN.test(match[1])) {
      return { ok: false, code: "invalid_navigator_url" };
    }
    return { ok: true, assetKey: match[1] };
  } catch {
    return { ok: false, code: "invalid_navigator_url" };
  }
}
