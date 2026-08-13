// Shared PNG-blob clipboard/download helpers used by every "copy as image"
// feature in this app (EXP share card in components/ShareImageButton.jsx,
// raffle settlement image in raffle/shareImage.js, ...). Extracted verbatim
// from ShareImageButton.jsx (T7) so the clipboard-write + download-fallback
// behavior lives in exactly one place; this is a behavior-preserving
// extraction, not a rewrite -- T7's copy/download flow is unchanged.

/** Triggers a browser download of `blob` named `fileName`. */
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Attempts to write a PNG blob to the OS clipboard via the async Clipboard
 * API. Returns false (never throws) when the API is unavailable (non-secure
 * context, unsupported browser, permission denial, etc.) so callers can fall
 * back to `downloadBlob`.
 */
export async function copyPngBlobToClipboard(blob) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    return false;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}
