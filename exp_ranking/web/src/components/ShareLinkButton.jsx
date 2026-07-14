import { useEffect, useRef, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const FEEDBACK_DURATION_MS = 2000;

/**
 * Copies `text` to the clipboard. `navigator.clipboard.writeText` is the
 * primary path; `document.execCommand('copy')` is only attempted as a
 * last-resort fallback when the Clipboard API is unavailable or denied
 * (IMPL_PLAN_T2 §10 — not the main path).
 */
async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy fallback below.
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * "Copy link" button for the ranking controls UI (IMPL_PLAN_T2 §10).
 * Copies the current, already-normalized URL (`window.location.href` —
 * by the time a user can click this, any same-tick `applyRoute` batch
 * from an earlier interaction has already flushed via microtask, so the
 * address bar reflects the canonical URL). Shows a success message only
 * on actual copy success; on failure, shows a manual-copy fallback
 * instead. Repeated clicks clear any pending feedback timer first, so
 * there is no timer race or leftover message.
 */
export default function ShareLinkButton({ t }) {
  const [status, setStatus] = useState("idle"); // idle | copied | failed
  const [fallbackUrl, setFallbackUrl] = useState("");
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleClick = async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const url = window.location.href;
    const ok = await copyToClipboard(url);
    setFallbackUrl(ok ? "" : url);
    setStatus(ok ? "copied" : "failed");
    timerRef.current = setTimeout(() => {
      setStatus("idle");
      timerRef.current = null;
    }, FEEDBACK_DURATION_MS);
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 border-slate-700"
        onClick={handleClick}
      >
        {status === "copied" ? (
          <Check size={14} className="mr-1.5 inline" />
        ) : (
          <Link2 size={14} className="mr-1.5 inline" />
        )}
        {status === "copied" ? t("share.copied") : t("share.copyLink")}
      </Button>
      {status === "failed" ? (
        <label className="flex w-full max-w-xs flex-col gap-1 text-xs text-amber-300/90">
          <span>{t("share.copyFailed")}</span>
          <input
            type="text"
            readOnly
            value={fallbackUrl}
            onFocus={(event) => event.target.select()}
            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200"
          />
        </label>
      ) : null}
    </div>
  );
}
