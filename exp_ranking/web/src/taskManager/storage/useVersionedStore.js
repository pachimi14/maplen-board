import { useCallback, useEffect, useRef, useState } from "react";

export function useVersionedStore(config) {
  const configRef = useRef(config);
  const [snapshot, setSnapshot] = useState(() => config.read());
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    function onStorage(event) {
      if (event.key !== configRef.current.key) return;
      const next = configRef.current.read();
      snapshotRef.current = next;
      setSnapshot(next);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
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
    return { ok: true, state: nextState };
  }, []);

  return { ...snapshot, update };
}
