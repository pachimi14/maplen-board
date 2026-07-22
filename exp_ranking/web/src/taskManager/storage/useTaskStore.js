import { useCallback, useEffect, useRef, useState } from "react";
import { migrateInstalledTemplateDeadlines } from "../domain/taskTemplates.js";
import { createTaskStorage, interpretTaskStorageEvent, readTaskState, writeTaskState } from "./taskStorage.js";

export function useTaskStore(presetOrVersion, storageOverride) {
  const preset = typeof presetOrVersion === "object" ? presetOrVersion : null;
  const presetVersion = preset?.version || presetOrVersion || "";
  const storageRef = useRef(null);
  if (storageRef.current === null) storageRef.current = storageOverride || createTaskStorage();
  const storage = storageRef.current;
  const [result, setResult] = useState(() => readTaskState(storage, presetVersion));
  const resultRef = useRef(result);
  resultRef.current = result;

  useEffect(() => {
    function onStorage(event) {
      const next = interpretTaskStorageEvent(event, presetVersion);
      if (!next) return;
      resultRef.current = next;
      setResult(next);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [presetVersion]);

  const update = useCallback((mutate) => {
    const current = resultRef.current;
    if (current.status === "unsupportedVersion") return { ok: false, code: "unsupportedVersion", state: current.state };
    const nextState = { ...mutate(current.state), presetVersion };
    const saved = writeTaskState(storage, nextState);
    if (!saved.ok) return { ok: false, code: "saveFailed", state: current.state };
    const next = { state: saved.state, status: "ok" };
    resultRef.current = next;
    setResult(next);
    return { ok: true, code: "saved", state: saved.state };
  }, [storage, presetVersion]);

  useEffect(() => {
    if (!preset || resultRef.current.status === "unsupportedVersion") return;
    const migrated = migrateInstalledTemplateDeadlines(resultRef.current.state, preset);
    if (migrated !== resultRef.current.state) update(() => migrated);
  }, [preset, presetVersion, update]);

  const replace = useCallback((nextState) => update(() => nextState), [update]);
  return { state: result.state, status: result.status, update, replace };
}
