// Shared clipboard/download helpers used by every "copy as image"/"copy as
// text" feature in this app (EXP share card in components/
// ShareImageButton.jsx, raffle settlement image in raffle/shareImage.js,
// raffle transfer notification text (LULU-103) in raffle/
// SettlementResult.jsx, ...). The PNG-blob helpers below are extracted
// verbatim from ShareImageButton.jsx (T7) so the clipboard-write +
// download-fallback behavior lives in exactly one place; this is a
// behavior-preserving extraction, not a rewrite -- T7's copy/download flow
// is unchanged.

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

/**
 * Copies plain text to the OS clipboard: tries the async Clipboard API
 * first, then falls back to a hidden textarea + `document.execCommand
 * ("copy")` -- unlike `navigator.clipboard.writeText`, the fallback also
 * works over plain http (non-secure-context) deployments (LULU-103: the
 * raffle-api review/VPS environment is not always https). Returns false
 * (never throws) when both paths fail.
 */
export async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the execCommand fallback below.
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.left = "-1000px";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}
