import { useCallback, useEffect, useRef, useState } from "react";

const STORE_UPDATED_EVENT = "maplen-board-store-updated";

export function useVersionedStore(config) {
  const configRef = useRef(config);
  const [snapshot, setSnapshot] = useState(() => config.read());
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    function reload(key) {
      if (key !== configRef.current.key) return;
      const next = configRef.current.read();
      snapshotRef.current = next;
      setSnapshot(next);
    }

    function onStorage(event) {
      reload(event.key);
    }

    function onLocalUpdate(event) {
      reload(event.detail?.key);
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener(STORE_UPDATED_EVENT, onLocalUpdate);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(STORE_UPDATED_EVENT, onLocalUpdate);
    };
  }, []);

  const update = useCallback((mutate) => {
    const current = configRef.current.read();
    if (current.status === "unsupportedVersion") return { ok: false, code: "unsupportedVersion" };
    const nextState = configRef.current.normalize(mutate(current.state));
    const result = configRef.current.write(nextState);
    if (!result.ok) return { ok: false, code: "saveFailed" };
    const next = { state: nextState, status: "ok" };
    snapshotRef.current = next;
    setSnapshot(next);
    window.dispatchEvent(new CustomEvent(STORE_UPDATED_EVENT, { detail: { key: configRef.current.key } }));
    return { ok: true, state: nextState };
  }, []);

  return { ...snapshot, update };
}
