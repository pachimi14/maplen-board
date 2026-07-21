import { useEffect, useRef, useState } from "react";

function utcIso(value) {
  return value ? new Date(`${value}:00Z`).toISOString() : null;
}

export default function AddTaskDialog({ open, fixedCadence, templates = [], onClose, onSubmit, t }) {
  const dialogRef = useRef(null);
  const [mode, setMode] = useState("custom");
  const [title, setTitle] = useState("");
  const [notify, setNotify] = useState(false);
  const [weekendOnly, setWeekendOnly] = useState(false);
  const [resetMode, setResetMode] = useState("none");
  const [resetAt, setResetAt] = useState("");
  const [resetEvery, setResetEvery] = useState("1");
  const [resetUnit, setResetUnit] = useState("day");
  const [dueAt, setDueAt] = useState("");
  const [visibleUntil, setVisibleUntil] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setMode("custom");
      setError("");
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function finish(result) {
    if (!result?.ok) {
      setError(t("backup.saveFailed"));
      return;
    }
    setTitle("");
    setNotify(false);
    setWeekendOnly(false);
    setResetMode("none"); setResetAt(""); setResetEvery("1"); setResetUnit("day"); setDueAt(""); setVisibleUntil("");
    setError("");
  }

  function submitCustom(event) {
    event.preventDefault();
    if (!title.trim()) {
      setError(t("form.required"));
      return;
    }
    if (fixedCadence === "custom" && resetMode !== "none" && !resetAt) {
      setError(t("form.resetRequired"));
      return;
    }
    const every = Number(resetEvery);
    if (fixedCadence === "custom" && resetMode === "interval" && (!Number.isInteger(every) || every < 1 || every > 365)) {
      setError(t("form.resetEveryInvalid"));
      return;
    }
    finish(onSubmit({ kind: "custom", title: title.trim(), cadence: fixedCadence, notify, availability: weekendOnly ? "weekend" : "always",
      resetRule: fixedCadence !== "custom" || resetMode === "none" ? { mode: "none" } : resetMode === "once" ? { mode: "once", firstAt: utcIso(resetAt) } : { mode: "interval", firstAt: utcIso(resetAt), every, unit: resetUnit },
      dueAt: fixedCadence === "custom" ? utcIso(dueAt) : null, visibleUntil: fixedCadence === "custom" ? utcIso(visibleUntil) : null,
    }));
  }

  function installTemplate(template) {
    finish(onSubmit({ kind: "template", template, cadence: fixedCadence, notify: false }));
  }

  const cadenceLabel = fixedCadence === "custom" ? t("task.customCadence") : fixedCadence === "weekly" ? t("task.weekly") : t("task.daily");
  const hasTemplates = templates.length > 0;

  return (
    <dialog ref={dialogRef} onClose={onClose} className="dialog-card backdrop:bg-slate-900/35">
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-emerald-600">{cadenceLabel}</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">{t("form.title")}</h2>
          </div>
          <button type="button" onClick={onClose} className="mini-button">{t("actions.close")}</button>
        </div>

        {hasTemplates ? (
          <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1" role="tablist" aria-label={t("form.addMethod")}>
            <button type="button" role="tab" aria-selected={mode === "custom"} onClick={() => { setMode("custom"); setError(""); }} className={`rounded-lg px-3 py-2 text-sm font-medium transition ${mode === "custom" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{t("form.customTab")}</button>
            <button type="button" role="tab" aria-selected={mode === "template"} onClick={() => { setMode("template"); setError(""); }} className={`rounded-lg px-3 py-2 text-sm font-medium transition ${mode === "template" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{t("form.templateTab")}</button>
          </div>
        ) : null}

        {mode === "template" && hasTemplates ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{t("form.templateHint")}</p>
            {templates.map((template) => (
              <article key={template.id} className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-900">{template.title}</h3>
                    <p className="mt-1 text-xs text-slate-500">{t("task.itemCount", { count: template.children.length })}</p>
                  </div>
                  <button type="button" onClick={() => installTemplate(template)} className="primary-button shrink-0">{t("form.addTemplate")}</button>
                </div>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {template.children.map((child) => <li key={child.title} className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600">{child.title}</li>)}
                </ul>
              </article>
            ))}
            {error ? <p className="text-xs text-rose-600">{error}</p> : null}
            <div className="flex justify-end"><button type="button" onClick={onClose} className="secondary-button">{t("actions.cancel")}</button></div>
          </div>
        ) : (
          <form onSubmit={submitCustom} className="space-y-5">
            <label className="block space-y-2 text-sm text-slate-700">
              <span>{t("form.name")}</span>
              <input autoFocus value={title} onChange={(event) => { setTitle(event.target.value); setError(""); }} placeholder={t("form.namePlaceholder")} className="field" />
              {error ? <span className="text-xs text-rose-600">{error}</span> : null}
            </label>
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">{fixedCadence === "custom" ? t("form.custom") : fixedCadence === "weekly" ? t("form.weekly") : t("form.daily")}</p>
            {fixedCadence === "custom" ? <section className="space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/35 p-3">
              <label className="block space-y-1 text-sm text-slate-700"><span>{t("task.resetRule")}</span><select value={resetMode} onChange={(event)=>setResetMode(event.target.value)} className="field"><option value="none">{t("task.resetNone")}</option><option value="once">{t("task.resetOnce")}</option><option value="interval">{t("task.resetInterval")}</option></select></label>
              {resetMode !== "none" ? <label className="block space-y-1 text-sm text-slate-700"><span>{t("task.firstResetAt")}</span><input type="datetime-local" value={resetAt} onChange={(event)=>setResetAt(event.target.value)} className="field"/><small className="text-slate-400">UTC</small></label> : null}
              {resetMode === "interval" ? <div className="grid grid-cols-[1fr_1fr] gap-2"><label className="block space-y-1 text-sm text-slate-700"><span>{t("task.resetEvery")}</span><input type="number" min="1" max="365" value={resetEvery} onChange={(event)=>setResetEvery(event.target.value)} className="field"/></label><label className="block space-y-1 text-sm text-slate-700"><span>{t("task.resetUnit")}</span><select value={resetUnit} onChange={(event)=>setResetUnit(event.target.value)} className="field"><option value="day">{t("task.days")}</option><option value="week">{t("task.weeks")}</option></select></label></div> : null}
              <label className="block space-y-1 text-sm text-slate-700"><span>{t("task.dueAt")}</span><input type="datetime-local" value={dueAt} onChange={(event)=>setDueAt(event.target.value)} className="field"/><small className="text-slate-400">{t("task.dueAtHint")} · UTC</small></label>
              <label className="block space-y-1 text-sm text-slate-700"><span>{t("task.visibleUntil")}</span><input type="datetime-local" value={visibleUntil} onChange={(event)=>setVisibleUntil(event.target.value)} className="field"/><small className="text-slate-400">{t("task.visibleUntilHint")} · UTC</small></label>
            </section> : null}            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-300 p-3 text-sm text-slate-700">
              <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} className="accent-emerald-500" />
              {t("form.notify")}
            </label>
            {fixedCadence === "weekly" ? <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-sm text-slate-700"><input type="checkbox" checked={weekendOnly} onChange={(event) => setWeekendOnly(event.target.checked)} className="accent-amber-500" />{t("form.weekendOnly")}</label> : null}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={onClose} className="secondary-button">{t("actions.cancel")}</button>
              <button type="submit" className="primary-button">{t("actions.save")}</button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
