import { useEffect, useState } from "react";
import AppToolbar from "../components/AppToolbar.jsx";
import ScheduleDialog from "../components/ScheduleDialog.jsx";
import {
  localDateKey,
  removeSchedule,
  schedulesForDate,
  scheduleWeekDays,
  upsertSchedule,
} from "../domain/scheduleModel.js";
import { useTranslation } from "../i18n/useTaskTranslation.jsx";
import { useScheduleStore } from "../storage/useScheduleStore.js";

function weekRangeLabel(days) {
  const format = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric" });
  return `${format.format(days[0])} 〜 ${format.format(days[6])}`;
}

function CalendarItem({ item, onEdit, onDelete, t }) {
  return (
    <article className={`rounded-xl border p-3 shadow-sm ${item.category === "boss" ? "border-rose-200 bg-rose-50" : "border-sky-200 bg-sky-50"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-700">{item.time}</p>
        <span className={`h-2 w-2 shrink-0 rounded-full ${item.category === "boss" ? "bg-rose-500" : "bg-sky-500"}`} />
      </div>
      <h3 className="mt-2 break-words text-sm font-semibold leading-5 text-slate-900">{item.title}</h3>
      {item.note ? <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-slate-600">{item.note}</p> : null}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onEdit(item)} className="mini-button">{t("actions.edit")}</button>
        <button type="button" onClick={() => onDelete(item.id)} className="mini-button text-rose-600">{t("actions.delete")}</button>
      </div>
    </article>
  );
}

function DayColumn({ date, items, todayKey, onCreate, onEdit, onDelete, t }) {
  const dateKey = localDateKey(date);
  const isToday = dateKey === todayKey;
  const weekday = t("schedule.weekdayShort")[date.getDay()];
  return (
    <section className={`min-h-[28rem] border-r border-slate-200 last:border-r-0 ${isToday ? "bg-emerald-50/60" : "bg-white"}`}>
      <div className={`border-b px-3 py-3 text-center ${isToday ? "border-emerald-200 bg-emerald-100" : "border-slate-200 bg-slate-50"}`}>
        <p className={`text-xs font-semibold ${isToday ? "text-emerald-800" : "text-slate-500"}`}>{weekday}</p>
        <p className={`mt-1 text-lg font-semibold ${isToday ? "text-emerald-900" : "text-slate-900"}`}>{date.getMonth() + 1}/{date.getDate()}</p>
        {isToday ? <span className="mt-1 inline-block rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">{t("app.today")}</span> : null}
      </div>
      <div className="space-y-2 p-2.5">
        {items.map((item) => <CalendarItem key={item.id} item={item} onEdit={onEdit} onDelete={onDelete} t={t} />)}
        {!items.length ? <button type="button" onClick={() => onCreate(date)} className="group grid min-h-[21rem] w-full place-items-center rounded-xl border border-dashed border-transparent text-xs text-slate-400 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"><span>＋ {t("schedule.dayEmpty")}</span></button> : null}
      </div>
    </section>
  );
}

export default function SchedulePage() {
  const { t } = useTranslation();
  const { state, status, update } = useScheduleStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [initialDate, setInitialDate] = useState(null);
  const [error, setError] = useState("");
  const [today, setToday] = useState(() => new Date());
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setToday(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const weekDays = scheduleWeekDays(weekAnchor);
  const todayKey = localDateKey(today);

  function moveWeek(days) {
    setWeekAnchor((current) => new Date(current.getFullYear(), current.getMonth(), current.getDate() + days));
  }

  function openNew(date = new Date()) {
    setEditing(null);
    setInitialDate(localDateKey(date));
    setDialogOpen(true);
  }

  function save(input) {
    const item = {
      ...input,
      id: input.id || `schedule:${globalThis.crypto?.randomUUID?.() || Date.now()}`,
      createdAt: input.createdAt || new Date().toISOString(),
    };
    const result = update((current) => upsertSchedule(current, item).state);
    setError(result.ok ? "" : t("schedule.saveFailed"));
    if (result.ok) {
      setDialogOpen(false);
      setEditing(null);
      if (item.recurrence === "once") setWeekAnchor(new Date(`${item.date}T12:00:00`));
    }
    return result;
  }

  function remove(id) {
    const result = update((current) => removeSchedule(current, id).state);
    if (!result.ok) setError(t("schedule.saveFailed"));
  }

  const storageMessage = ["corrupt", "unsupportedVersion", "storageError"].includes(status)
    ? t(`status.${status}`)
    : "";

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t("nav.schedule")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("schedule.weekStartsThursday")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2"><AppToolbar active="schedule" /><button type="button" className="primary-button" onClick={() => openNew()}>＋ {t("schedule.add")}</button></div>
      </section>
      {error || storageMessage ? <div role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{error || storageMessage}</div> : null}
      <section className="panel-card overflow-hidden">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-emerald-600">WEEK</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">{weekRangeLabel(weekDays)}</h2>
            <p className="mt-1 text-xs text-slate-500">{t("schedule.localTime")}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:flex">
            <button type="button" onClick={() => moveWeek(-7)} className="secondary-button">← {t("schedule.previousWeek")}</button>
            <button type="button" onClick={() => setWeekAnchor(new Date())} className="secondary-button">{t("schedule.currentWeek")}</button>
            <button type="button" onClick={() => moveWeek(7)} className="secondary-button">{t("schedule.nextWeek")} →</button>
          </div>
        </div>
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6" role="region" aria-label={t("schedule.weekView")}>
          <div className="grid min-w-[63rem] grid-cols-7 overflow-hidden rounded-2xl border border-slate-200">
            {weekDays.map((date) => (
              <DayColumn
                key={localDateKey(date)}
                date={date}
                items={schedulesForDate(state, date)}
                todayKey={todayKey}
                onCreate={openNew}
                onEdit={(value) => { setEditing(value); setInitialDate(null); setDialogOpen(true); }}
                onDelete={remove}
                t={t}
              />
            ))}
          </div>
        </div>
      </section>
      <ScheduleDialog open={dialogOpen} item={editing} initialDate={initialDate} onClose={() => { setDialogOpen(false); setEditing(null); setInitialDate(null); }} onSubmit={save} t={t} />
    </main>
  );
}
