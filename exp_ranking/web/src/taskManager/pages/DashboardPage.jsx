import { useEffect, useMemo, useState } from "react";
import preset from "../data/presets.json";
import CharacterPickerDialog from "../components/CharacterPickerDialog.jsx";
import AppToolbar from "../components/AppToolbar.jsx";
import DashboardTasks from "../components/DashboardTasks.jsx";
import NotificationBackgroundSync from "../components/NotificationBackgroundSync.jsx";
import { claimLegacyDailyExpGoal, dailyExpGoalProgress, dailyExpGoalRemaining, getDailyExpGoal, parseDailyExpGoal, setDailyExpGoal, setReminderMemo } from "../domain/dashboardModel.js";
import { calculateLiveExp } from "../domain/liveExp.js";
import { buildEventViews, mergeTasks, summarizeTasks } from "../domain/mergeTasks.js";
import { buildNotificationSnapshot } from "../domain/notificationModel.js";
import { getResetSnapshot } from "../domain/reset.js";
import { schedulesForDate } from "../domain/scheduleModel.js";
import { listTaskTabs, toggleTaskCompletion } from "../domain/taskModel.js";
import { useLiveExp } from "../hooks/useLiveExp.js";
import { useTranslation } from "../i18n/useTaskTranslation.jsx";
import { useBoard } from "../../board/BoardContext.jsx";
import { useProfile } from "../../profile/ProfileContext.jsx";
import { ROUTES } from "../routing/hashRoute.js";
import { useDashboardStore } from "../storage/useDashboardStore.js";
import { useEventStore } from "../storage/useEventStore.js";
import { useScheduleStore } from "../storage/useScheduleStore.js";
import { useTaskStore } from "../storage/useTaskStore.js";
import { formatExp, formatRemaining } from "../utils/format.js";

const DASHBOARD_CHARACTER_LIMIT = 2;

function SectionHeading({ icon, eyebrow, action, accent = "text-emerald-600" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-50 text-sm ring-1 ring-emerald-100 ${accent}`}>{icon}</span>
        <h2 className={`truncate text-xl font-bold tracking-[0.12em] ${accent}`}>{eyebrow}</h2>
      </div>
      {action}
    </div>
  );
}

function TodayScheduleCard({ items, t }) {
  return (
    <section className="dashboard-card min-h-0 overflow-hidden">
      <SectionHeading icon="◷" eyebrow="TODAY" action={<a href={ROUTES.schedule} className="dashboard-link">{t("dashboard.openSchedule")}</a>} />
      <div className="mt-2 space-y-1.5">
        {items.slice(0, 3).map((item) => <div key={item.id} className="dashboard-schedule-row flex items-center gap-2 rounded-lg bg-emerald-50/70 px-2.5 py-1.5"><span className="w-12 shrink-0 text-sm font-bold text-slate-800">{item.time}</span><span className={`h-2 w-2 rounded-full ${item.category === "boss" ? "bg-rose-500" : "bg-sky-500"}`} /><span className="min-w-0 flex-1 truncate text-sm text-slate-700">{item.title}</span></div>)}
        {items.length > 3 ? <p className="text-xs font-medium text-emerald-600">+{items.length - 3}</p> : null}
        {!items.length ? <p className="rounded-lg border border-dashed border-emerald-200 py-4 text-center text-sm text-emerald-700">{t("schedule.todayEmpty")}</p> : null}
      </div>
    </section>
  );
}

function MemoCard({ value, onChange, t }) {
  return (
    <section className="dashboard-card flex min-h-[10rem] flex-col overflow-hidden">
      <SectionHeading icon="✎" eyebrow="REMIND" accent="text-rose-500" />
      <textarea value={value} onChange={onChange} placeholder={t("dashboard.memoPlaceholder")} className="mt-2 min-h-[6.5rem] w-full flex-1 resize-none rounded-xl border border-rose-100 bg-rose-50/35 px-3 py-2 text-sm leading-5 text-slate-800 outline-none placeholder:text-rose-300 focus:border-rose-300" />
    </section>
  );
}

function dataIsStale(dateValue, now) {
  if (!dateValue) return true;
  const date = new Date(`${dateValue}T00:00:00Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Number.isNaN(date.getTime()) || today - date.getTime() > 2 * 86400000;
}

function CharacterTabs({ keys, activeKey, byKey, primaryKey, onSelect, t }) {
  return (
    <div className="mt-2 flex min-w-0 gap-1 overflow-x-auto pb-1">
      {keys.map((key) => {
        const character = byKey.get(key);
        const selected = activeKey === key;
        return (
          <button key={key} type="button" onClick={() => onSelect(key)} className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-left text-xs font-semibold transition ${selected ? "border-emerald-300 bg-emerald-100 text-emerald-900" : "border-slate-200 bg-white text-slate-500 hover:border-emerald-200 hover:text-slate-800"}`} aria-pressed={selected}>
            <span className="block max-w-24 truncate">{character?.name || key}</span>
            {primaryKey === key ? <span className="text-[10px] text-emerald-600">{t("characters.main")}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function FeaturedCharacter({ historyKey, character, primary, dataDate, stale, live, liveModel, dailyExpGoal, onSaveGoal, onRemove, t, language }) {
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [goalError, setGoalError] = useState("");
  const navigatorUrl = character?.navigatorUrl || (character?.characterAssetKey ? `https://msu.io/navigator/character/${encodeURIComponent(character.characterAssetKey)}` : "");
  const hasLiveExp = ["ok", "stale"].includes(live.status) && liveModel?.ok;
  const gain = hasLiveExp ? liveModel.gainNumber : null;
  const gainExact = hasLiveExp ? liveModel.gain : "";
  const startPercent = character?.levelExpPercent ?? 0;
  const currentPercent = hasLiveExp ? liveModel.levelExpPercent : null;
  const goalPercent = hasLiveExp ? dailyExpGoalProgress(gainExact, dailyExpGoal) : null;
  const goalRemaining = hasLiveExp ? dailyExpGoalRemaining(gainExact, dailyExpGoal) : null;
  let liveLabel = stale ? t("characters.updatePending", { date: dataDate || "—" }) : t("characters.dataDate", { date: dataDate || "—" });
  if (liveModel?.code === "baselinePending") liveLabel = t("characters.liveBaselinePending");
  else if (live.status === "loading") liveLabel = t("characters.liveUpdating");
  else if (liveModel?.ok && live.data?.stale) liveLabel = t("characters.liveDelayed");
  else if (liveModel?.ok) liveLabel = t("characters.liveUpdated", { time: new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" }).format(new Date(live.data.fetchedAt)) });
  else if (live.status === "error") liveLabel = t("characters.liveUnavailable");
  function beginGoalEdit() { setGoalInput(dailyExpGoal ? String(Number(dailyExpGoal) / 1_000_000_000) : ""); setGoalError(""); setEditingGoal(true); }
  function submitGoal(event) {
    event.preventDefault();
    const parsed = parseDailyExpGoal(goalInput);
    if (!parsed) { setGoalError(t("characters.goalInvalid")); return; }
    onSaveGoal(parsed); setEditingGoal(false); setGoalError("");
  }
  return (
    <div className="dashboard-character-detail mt-3 rounded-xl border border-emerald-100 bg-gradient-to-br from-white to-emerald-50/65 p-3">
      <div className="flex gap-3">
        {character?.imageUrl ? <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-emerald-100"><img src={character.imageUrl} alt="" className="h-full w-full -translate-y-3 scale-200 object-contain" /></div> : <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-slate-100 text-xs text-slate-400">No Data</div>}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-base font-bold text-slate-900">{character?.name || historyKey}</h3><p className="mt-0.5 truncate text-sm text-slate-500">{character ? `Lv.${hasLiveExp ? liveModel.level : character.level} · ${character.job}` : t("characters.dataMissing")}</p></div>{primary ? <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">{t("characters.main")}</span> : null}</div>
          {character?.level < 225 ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-medium leading-5 text-amber-800">{t("characters.expLevelUnavailable")}</p> : null}
          {character && character.level >= 225 ? <div className="mt-2.5"><div className="flex items-end justify-between gap-3"><div><div className="flex items-center gap-2"><p className="text-xs font-medium text-slate-500">{t("characters.todayGain")}</p><button type="button" onClick={live.refresh} disabled={!live.canRefresh} className="text-xs font-semibold text-emerald-600 disabled:text-slate-300" title={t("characters.refreshExp")}>↻</button></div><p className={`font-bold text-emerald-700 ${hasLiveExp ? "text-xl" : "text-sm"}`}>{hasLiveExp ? `+${formatExp(gain, t.language)}` : t("characters.liveWaiting")}</p></div><div className="grid grid-cols-2 gap-x-3 text-right text-xs"><span className="text-slate-400">{t("characters.startPercent")}</span><span className="font-bold text-slate-600">{Number(startPercent).toFixed(2)}%</span><span className="text-slate-400">{t("characters.currentPercent")}</span><span className="font-bold text-emerald-700">{currentPercent === null ? "—" : `${Number(currentPercent).toFixed(2)}%`}</span></div></div>
          {editingGoal ? <form onSubmit={submitGoal} className="mt-2 flex flex-wrap items-center gap-1.5"><label className="flex min-w-0 flex-1 items-center overflow-hidden rounded-lg border border-emerald-300 bg-white focus-within:ring-2 focus-within:ring-emerald-100"><input autoFocus inputMode="decimal" value={goalInput} onChange={(event) => setGoalInput(event.target.value)} placeholder={t("characters.goalPlaceholder")} className="min-w-0 flex-1 px-2 py-1 text-sm outline-none" /><span className="border-l border-emerald-100 bg-emerald-50 px-2 py-1 text-sm font-bold text-emerald-700">B</span></label><button type="submit" className="dashboard-action px-2 py-1">{t("actions.save")}</button><button type="button" onClick={() => setEditingGoal(false)} className="dashboard-link">{t("actions.cancel")}</button>{goalError ? <p className="w-full text-xs text-rose-500">{goalError}</p> : null}</form> : <div className="mt-2 flex items-center justify-between gap-3 text-xs"><span className="text-slate-500">{dailyExpGoal ? t("characters.goalValue", { value: formatExp(Number(dailyExpGoal), t.language) }) : t("characters.goalUnset")}</span><button type="button" onClick={beginGoalEdit} className="rounded-lg border border-emerald-300 bg-white px-2.5 py-1 font-bold text-emerald-700 shadow-sm transition hover:bg-emerald-50">{dailyExpGoal ? t("characters.editGoal") : t("characters.setGoal")}</button><strong className="whitespace-nowrap text-emerald-700">{goalRemaining === null ? "—" : t("characters.goalRemaining", { value: formatExp(Number(goalRemaining), t.language) })}</strong></div>}
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white ring-1 ring-emerald-100"><div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-lime-300 transition-[width]" style={{ width: `${Math.min(100, Math.max(0, goalPercent || 0))}%` }} /></div><p className={`mt-1 truncate text-[11px] ${liveModel?.ok && !live.data?.stale ? "text-emerald-600" : "text-amber-600"}`}>{liveLabel}</p></div> : null}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3"><div className="flex min-w-0 flex-wrap gap-1.5"><a href={`https://lulumi-tools.com/#/character/${encodeURIComponent(historyKey)}`} target="_blank" rel="noreferrer" className="dashboard-link character-card-link">{t("characters.openLulumiDetail")}</a>{navigatorUrl ? <a href={navigatorUrl} target="_blank" rel="noreferrer" className="dashboard-link character-card-link">{t("characters.openNavigator")}</a> : null}</div><button type="button" onClick={onRemove} className="dashboard-link shrink-0 text-rose-500 hover:text-rose-600">{t("actions.delete")}</button></div>
    </div>
  );
}
function MyCharactersCard({ profile, ranking, dashboardState, onSaveGoal, onAdd, onRemove, onRetry, t, language }) {
  const byKey = useMemo(() => new Map(ranking.characters.map((character) => [character.historyKey, character])), [ranking.characters]);
  const dashboardKeys = useMemo(() => [profile.primaryHistoryKey, ...profile.pinnedHistoryKeys].filter((key, index, all) => key && all.indexOf(key) === index).slice(0, DASHBOARD_CHARACTER_LIMIT), [profile.primaryHistoryKey, profile.pinnedHistoryKeys]);
  const preferredKey = dashboardKeys[0] || "";
  const [selectedKey, setSelectedKey] = useState(preferredKey);
  useEffect(() => {
    if (!dashboardKeys.length) {
      setSelectedKey("");
      return;
    }
    if (!dashboardKeys.includes(selectedKey)) setSelectedKey(preferredKey);
  }, [preferredKey, dashboardKeys, selectedKey]);
  const activeKey = dashboardKeys.includes(selectedKey) ? selectedKey : preferredKey;
  const activeCharacter = byKey.get(activeKey);
  const live = useLiveExp(activeCharacter?.level >= 225 ? activeCharacter?.characterAssetKey || "" : "");
  const liveModel = useMemo(() => live.data && activeCharacter ? calculateLiveExp({ baseline: activeCharacter, current: live.data, expTable: ranking.meta.expTable, baselineUpdatedAt: ranking.meta.updatedAt }) : null, [activeCharacter, live.data, ranking.meta.expTable, ranking.meta.updatedAt]);
  const dataDate = ranking.meta.dailyPeriodEnd || ranking.meta.latestSnapshotDate;
  const stale = dataIsStale(dataDate, new Date());
  return (
    <section className="dashboard-card min-h-0 overflow-hidden">
      <SectionHeading icon="♙" eyebrow="MY CHARACTERS" action={<button type="button" onClick={onAdd} disabled={dashboardKeys.length >= DASHBOARD_CHARACTER_LIMIT} className="dashboard-action disabled:opacity-40">＋ {t("characters.add")}</button>} accent="text-emerald-600" />
      {ranking.status === "loading" && profile.pinnedHistoryKeys.length ? <p className="mt-3 rounded-xl bg-emerald-50 py-12 text-center text-sm text-emerald-700">{t("characters.loading")}</p> : null}
      {ranking.status === "error" && profile.pinnedHistoryKeys.length ? <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><span>{t("characters.loadFailed")}</span><button type="button" onClick={onRetry} className="dashboard-link ml-2">{t("actions.retry")}</button></div> : null}
      {!profile.pinnedHistoryKeys.length ? <button type="button" onClick={onAdd} className="mt-3 w-full rounded-xl border border-dashed border-emerald-200 py-12 text-center text-sm text-emerald-700 hover:bg-emerald-50">＋ {t("characters.empty")}</button> : null}
      {profile.pinnedHistoryKeys.length ? <CharacterTabs keys={dashboardKeys} activeKey={activeKey} byKey={byKey} primaryKey={profile.primaryHistoryKey} onSelect={setSelectedKey} t={t} /> : null}
      {activeKey && (ranking.status === "ok" || activeCharacter) ? <FeaturedCharacter historyKey={activeKey} character={activeCharacter} live={live} liveModel={liveModel} dailyExpGoal={getDailyExpGoal(dashboardState, activeKey)} onSaveGoal={(goal) => onSaveGoal(activeKey, goal)} primary={profile.primaryHistoryKey === activeKey} dataDate={dataDate} stale={stale} onRemove={() => onRemove(activeKey)} t={t} language={language} /> : null}
    </section>
  );
}

function CompactEvents({ events, t }) {
  return (
    <section className="dashboard-card min-h-0 overflow-hidden">
      <SectionHeading icon="◈" eyebrow="EVENT" action={<span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-600 ring-1 ring-emerald-100">{events.length}</span>} />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {events.map((event) => (
          <article key={event.id} className="dashboard-event-item rounded-xl border border-orange-100 bg-orange-50/45 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-orange-600">{t(`event.${event.status}`)}</span>
              <p className="shrink-0 text-sm font-bold text-orange-600">{formatRemaining(event.remainingMs, t.language)}</p>
            </div>
            <h3 className="mt-1 break-words text-sm font-semibold leading-5 text-slate-800" title={event.label}>{event.label}</h3>{event.note ? <p className="mt-1 line-clamp-2 break-words text-xs leading-4 text-slate-500" title={event.note}>{event.note}</p> : null}
          </article>
        ))}
        {!events.length ? <div className="rounded-xl border border-dashed border-emerald-200 py-8 text-center sm:col-span-2"><p className="text-sm font-medium text-slate-600">{t("event.emptyTitle")}</p><p className="mt-1 text-xs text-slate-400">{t("event.emptyHint")}</p></div> : null}
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const { t, language } = useTranslation();
  const taskStore = useTaskStore(preset);
  const scheduleStore = useScheduleStore();
  const dashboardStore = useDashboardStore();
  const eventStore = useEventStore();
  const profileStore = useProfile();
  const board = useBoard();
  const ranking = {
    status: board.loading ? "loading" : board.loadError ? "error" : "ok",
    characters: board.characters,
    meta: board.meta,
  };
  const [now, setNow] = useState(() => new Date());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (dashboardStore.state.legacyDailyExpGoal && profileStore.profile.primaryHistoryKey) {
      dashboardStore.update((state) => claimLegacyDailyExpGoal(state, profileStore.profile.primaryHistoryKey));
    }
  }, [dashboardStore.state.legacyDailyExpGoal, profileStore.profile.primaryHistoryKey]);

  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60000); return () => window.clearInterval(timer); }, []);

  const taskView = useMemo(() => mergeTasks(preset, taskStore.state, now, { language, includeHidden: false }), [now, taskStore.state, language]);
  const resetSnapshot = useMemo(() => getResetSnapshot(now), [now]);
  const daily = summarizeTasks(taskView.daily);
  const weekly = summarizeTasks(taskView.weekly);
  const custom = summarizeTasks(taskView.custom);
  const notificationSnapshot = useMemo(() => buildNotificationSnapshot(taskView, taskStore.state.notificationSettings), [taskStore.state.notificationSettings, taskView]);
  const taskTabs = useMemo(() => listTaskTabs(taskStore.state), [taskStore.state]);
  const todaySchedules = schedulesForDate(scheduleStore.state, now);
  const eventViews = useMemo(() => buildEventViews({ events: eventStore.state.items }, now, language), [eventStore.state.items, now, language]);
  function toggleTask(task) { const result = taskStore.update((current) => toggleTaskCompletion(current, task, now)); setMessage(result.ok ? "" : t("backup.saveFailed")); }
  function registerDashboardCharacter(key) {
    if (profileStore.profile.pinnedHistoryKeys.length >= DASHBOARD_CHARACTER_LIMIT) {
      setMessage(t("characters.limitReached"));
      return { ok: false, code: "limitReached" };
    }
    const result = profileStore.pin(key);
    setMessage(result.ok ? "" : t(`characters.${result.code}`));
    if (result.ok) setPickerOpen(false);
    return result;
  }
  const warnings = [taskStore.status, scheduleStore.status, dashboardStore.status, eventStore.status, profileStore.status].filter((status) => ["corrupt", "unsupportedVersion", "storageError"].includes(status));

  return (
    <main className="dashboard-shell mx-auto max-w-7xl px-4 py-2 sm:px-6 lg:px-8">
      <NotificationBackgroundSync snapshot={notificationSnapshot} />
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3"><h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("nav.dashboard")}</h1><div className="flex flex-wrap items-center justify-end gap-2"><AppToolbar active="dashboard" /><p className="rounded-full border border-emerald-100 bg-white/75 px-3 py-1 text-sm font-medium text-slate-500">{new Intl.DateTimeFormat(language, { dateStyle: "full" }).format(now)}</p></div></header>
      {warnings.length || message ? <div role="alert" className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{message || t(`status.${warnings[0]}`)}</div> : null}
      <section className="grid items-start gap-3 lg:grid-cols-12">
        <div className="lg:col-span-7 lg:row-span-2 lg:self-stretch"><DashboardTasks daily={taskView.daily} weekly={taskView.weekly} custom={taskView.custom} dailyTabs={taskTabs} weeklyTabs={taskTabs} dailySummary={daily} weeklySummary={weekly} customSummary={custom} dailyResetMs={resetSnapshot.daily.remainingMs} weeklyResetMs={resetSnapshot.weekly.remainingMs} onToggle={toggleTask} t={t} /></div>
        <div className="lg:col-span-5"><MyCharactersCard profile={profileStore.profile} ranking={ranking} dashboardState={dashboardStore.state} onSaveGoal={(key, goal) => { const result = dashboardStore.update((state) => setDailyExpGoal(state, key, goal)); setMessage(result.ok ? "" : t("backup.saveFailed")); }} onAdd={() => setPickerOpen(true)} onRemove={(key) => { const result = profileStore.unpin(key); setMessage(result.ok ? "" : t(`characters.${result.code}`)); }} onRetry={() => {}} t={t} language={language} /></div>
        <div className="lg:col-span-5"><TodayScheduleCard items={todaySchedules} t={t} /></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:col-span-12">
          <CompactEvents events={eventViews} t={t} />
          <MemoCard value={dashboardStore.state.reminderMemo} onChange={(event) => { const result = dashboardStore.update((state) => setReminderMemo(state, event.target.value)); setMessage(result.ok ? "" : t("dashboard.memoSaveFailed")); }} t={t} />
        </div>
      </section>
      <CharacterPickerDialog open={pickerOpen} loading={ranking.status === "loading"} characters={ranking.characters} registeredKeys={profileStore.profile.pinnedHistoryKeys} onClose={() => setPickerOpen(false)} onRegister={registerDashboardCharacter} onRetry={() => {}} t={t} language={language} />
    </main>
  );
}
