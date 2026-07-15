export function characterDetailUrl(character, locationLike = window.location) {
  const origin = locationLike?.origin || "https://lulumi-tools.com";
  const pathname = locationLike?.pathname || "/";
  const key = character?.historyKey || character?.id || character?.name || "";
  return `${origin}${pathname}#/character/${encodeURIComponent(key)}`;
}

export function safeShareFileName(character, date = new Date()) {
  const rawName = String(character?.name || "character").trim() || "character";
  const safeName = rawName
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 60)
    .replace(/^_+|_+$/g, "") || "character";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `lulumi-tools_${safeName}_${year}-${month}-${day}.png`;
}

export function buildShareText(character, detailUrl, t) {
  const name = character?.name || "Character";
  const level = character?.level ?? "-";
  const percent = Number(character?.levelExpPercent ?? character?.expPercent ?? 0).toFixed(3);
  const title = t ? t("shareImage.postText", { name, level, percent }) : `${name} Lv.${level} ${percent}%`;
  return `${title}\n${detailUrl}`;
}

export function xIntentUrl(text) {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}
