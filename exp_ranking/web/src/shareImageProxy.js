const MARKET_CHARIMAGE_PREFIX = "https://market-static.msu.io/msu/platform/charimages/";
const DEFAULT_SHARE_IMAGE_PROXY_BASE = "https://api.lulumi-tools.com";
const SAFE_PROXY_PATH_PATTERN = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9=_-]+\.png$/;

export function toShareProxyUrl(imageUrl, proxyBase = DEFAULT_SHARE_IMAGE_PROXY_BASE) {
  if (!imageUrl || !proxyBase) {
    return null;
  }

  const rawImageUrl = String(imageUrl);
  if (rawImageUrl.includes("..") || /%2e/i.test(rawImageUrl)) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(rawImageUrl);
  } catch {
    return null;
  }

  const normalizedSource = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  if (!normalizedSource.startsWith(MARKET_CHARIMAGE_PREFIX)) {
    return null;
  }

  const path = normalizedSource.slice(MARKET_CHARIMAGE_PREFIX.length);
  if (path.length > 512 || path.includes("..") || path.includes("\\")) {
    return null;
  }
  if (!SAFE_PROXY_PATH_PATTERN.test(path)) {
    return null;
  }

  const normalizedBase = String(proxyBase).replace(/\/+$/, "");
  return `${normalizedBase}/img/charimages/${path}`;
}

export { DEFAULT_SHARE_IMAGE_PROXY_BASE };
