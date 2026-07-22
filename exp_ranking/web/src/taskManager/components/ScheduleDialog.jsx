import { useEffect, useRef, useState } from "react";
import { localDateKey } from "../domain/scheduleModel.js";

export default function ScheduleDialog({ open, item, initialDate, onClose, onSubmit, t }) {
  const dialogRef = useRef(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("boss");
  const [recurrence, setRecurrence] = useState("once");
  const [date, setDate] = useState(localDateKey());
  const [weekday, setWeekday] = useState(new Date().getDay());
  const [time, setTime] = useState("21:00");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const defaultDate = initialDate || localDateKey();
    setTitle(item?.title || "");
    setCategory(item?.category || "boss");
    setRecurrence(item?.recurrence || "once");
    setDate(item?.date || defaultDate);
    setWeekday(item?.weekday ?? new Date(`${defaultDate}T12:00:00`).getDay());
    setTime(item?.time || "21:00");
    setNote(item?.note || "");
    setError("");
  }, [initialDate, item, open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function submit(event) {
    event.preventDefault();
    if (!title.trim()) {
      setError(t("schedule.required"));
      return;
    }
    const result = onSubmit({
      ...item,
      title: title.trim(),
      category,
      recurrence,
      date: recurrence === "once" ? date : undefined,
      weekday: recurrence === "weekly" ? Number(weekday) : undefined,
      time,
      note,
    });
    if (!result?.ok) setError(t("schedule.saveFailed"));
  }

  return (
    <dialog ref={dialogRef} onClose={onClose} className="dialog-card backdrop:bg-slate-900/35">
      <form onSubmit={submit} className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-slate-900">{item ? t("schedule.edit") : t("schedule.add")}</h2>
          <button type="button" onClick={onClose} className="mini-button">{t("actions.close")}</button>
        </div>
        <label className="block space-y-2 text-sm text-slate-700">
          <span>{t("schedule.title")}</span>
          <input autoFocus className="field" value={title} onChange={(event) => { setTitle(event.target.value); setError(""); }} placeholder={t("schedule.placeholder")} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-2 text-sm text-slate-700">
            <span>{t("schedule.category")}</span>
            <select className="field" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="boss">{t("schedule.boss")}</option>
              <option value="other">{t("schedule.other")}</option>
            </select>
          </label>
          <label className="block space-y-2 text-sm text-slate-700">
            <span>{t("schedule.recurrence")}</span>
            <select className="field" value={recurrence} onChange={(event) => setRecurrence(event.target.value)}>
              <option value="once">{t("schedule.once")}</option>
              <option value="weekly">{t("schedule.weekly")}</option>
            </select>
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {recurrence === "once" ? (
            <label className="block space-y-2 text-sm text-slate-700">
              <span>{t("schedule.date")}</span>
              <input type="date" className="field" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
          ) : (
            <label className="block space-y-2 text-sm text-slate-700">
              <span>{t("schedule.weekday")}</span>
              <select className="field" value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>
                {t("schedule.weekdays").map((label, index) => <option key={label} value={index}>{label}</option>)}
              </select>
            </label>
          )}
          <label className="block space-y-2 text-sm text-slate-700">
            <span>{t("schedule.time")}</span>
            <input type="time" className="field" value={time} onInput={(event) => setTime(event.currentTarget.value)} />
          </label>
        </div>
        <label className="block space-y-2 text-sm text-slate-700">
          <span>{t("schedule.note")}</span>
          <textarea className="field min-h-24 resize-y" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="secondary-button">{t("actions.cancel")}</button>
          <button type="submit" className="primary-button">{t("actions.save")}</button>
        </div>
      </form>
    </dialog>
  );
}
