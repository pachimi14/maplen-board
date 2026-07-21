import { useEffect, useRef, useState } from "react";
import { exportTaskBackup, importTaskBackup } from "../storage/taskStorage.js";

export default function BackupDialog({ open, onClose, state, onImport, t }) {
  const dialogRef = useRef(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function download() {
    const json = exportTaskBackup(state);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `lulumi-tasks-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage(t("backup.exported"));
  }

  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const result = importTaskBackup(await file.text(), state.presetVersion);
    if (!result.ok) {
      setMessage(t(`backup.${result.code}`));
      return;
    }
    const saved = onImport(result.state);
    setMessage(saved.ok ? t("backup.imported") : t("backup.saveFailed"));
  }

  return (
    <dialog ref={dialogRef} onClose={onClose} className="dialog-card backdrop:bg-slate-900/35">
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-slate-900">{t("backup.title")}</h2>
          <button type="button" onClick={onClose} className="mini-button">{t("actions.close")}</button>
        </div>
        <p className="text-sm leading-6 text-slate-600">{t("backup.description")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={download} className="primary-button">{t("actions.export")}</button>
          <label className="secondary-button cursor-pointer text-center">
            {t("actions.import")}
            <input type="file" accept="application/json,.json" onChange={importFile} className="sr-only" />
          </label>
        </div>
        {message ? <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}
      </div>
    </dialog>
  );
}
