import { useCallback, useEffect, useRef, useState } from "react";
import { liveExpSource } from "../integrations/liveExpSource.js";

export const LIVE_EXP_INTERVAL_MS = 300000;

export function refreshIsDue(lastStartedAt, now = Date.now(), interval = LIVE_EXP_INTERVAL_MS) {
  return !lastStartedAt || now - lastStartedAt >= interval;
}

export function useLiveExp(assetKey) {
  const idle = { status: "idle", data: null, code: "idle", lastStartedAt: 0 };
  const [state, setState] = useState(idle);
  const requestRef = useRef(null);
  const cacheRef = useRef(new Map());
  const lastStartedRef = useRef(new Map());
  const keyRef = useRef(assetKey);
  keyRef.current = assetKey;

  const refresh = useCallback(async () => {
    if (!assetKey || document.visibilityState !== "visible") return false;
    const startedAt = Date.now();
    const previousStartedAt = lastStartedRef.current.get(assetKey) || 0;
    if (!refreshIsDue(previousStartedAt, startedAt)) return false;
    lastStartedRef.current.set(assetKey, startedAt);
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState((current) => ({ ...current, status: "loading", lastStartedAt: startedAt }));
    const result = await liveExpSource.load(assetKey, { signal: controller.signal });
    if (controller.signal.aborted || keyRef.current !== assetKey) return false;
    if (result.ok) {
      const next = { status: result.data.stale ? "stale" : "ok", data: result.data, code: "ok", lastStartedAt: startedAt };
      cacheRef.current.set(assetKey, next);
      setState(next);
    } else if (result.code !== "aborted") {
      const next = { status: "error", data: cacheRef.current.get(assetKey)?.data || null, code: result.code, lastStartedAt: startedAt };
      cacheRef.current.set(assetKey, next);
      setState(next);
    }
    return result.ok;
  }, [assetKey]);

  useEffect(() => {
    requestRef.current?.abort();
    setState(cacheRef.current.get(assetKey) || idle);
    if (!assetKey) return undefined;
    let timer;
    const schedule = () => {
      window.clearInterval(timer);
      if (document.visibilityState === "visible") {
        if (refreshIsDue(lastStartedRef.current.get(assetKey) || 0)) refresh();
        timer = window.setInterval(() => refresh(), LIVE_EXP_INTERVAL_MS);
      }
    };
    const onVisibility = () => document.visibilityState === "hidden" ? window.clearInterval(timer) : schedule();
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      requestRef.current?.abort();
    };
  }, [assetKey]);

  return { ...state, refresh, canRefresh: refreshIsDue(lastStartedRef.current.get(assetKey) || 0) && state.status !== "loading" };
}
