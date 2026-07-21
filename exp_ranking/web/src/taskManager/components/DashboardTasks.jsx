import { useState } from "react";
import { ROUTES } from "../routing/hashRoute.js";
import { summarizeTasks } from "../domain/mergeTasks.js";
import { formatCompactRemaining, formatRemaining, formatUtcDeadline } from "../utils/format.js";

const TAB_TONES = [
  { badge: "bg-sky-50 text-sky-700 ring-sky-100", idle: "bg-sky-50 text-sky-700", active: "bg-sky-100 text-sky-800 ring-1 ring-sky-200" },
  { badge: "bg-violet-50 text-violet-700 ring-violet-100", idle: "bg-violet-50 text-violet-700", active: "bg-violet-100 text-violet-800 ring-1 ring-violet-200" },
  { badge: "bg-amber-50 text-amber-700 ring-amber-100", idle: "bg-amber-50 text-amber-700", active: "bg-amber-100 text-amber-800 ring-1 ring-amber-200" },
  { badge: "bg-rose-50 text-rose-700 ring-rose-100", idle: "bg-rose-50 text-rose-700", active: "bg-rose-100 text-rose-800 ring-1 ring-rose-200" },
  { badge: "bg-cyan-50 text-cyan-700 ring-cyan-100", idle: "bg-cyan-50 text-cyan-700", active: "bg-cyan-100 text-cyan-800 ring-1 ring-cyan-200" },
  { badge: "bg-lime-50 text-lime-700 ring-lime-100", idle: "bg-lime-50 text-lime-700", active: "bg-lime-100 text-lime-800 ring-1 ring-lime-200" },
];

function tabTone(index) {
  return TAB_TONES[Math.max(0, index) % TAB_TONES.length];
}
function CheckIndicator({ task, small = false }) {
  const completed = task.progress.completed;
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full border transition ${small ? "h-5 w-5 text-xs" : "h-7 w-7 text-sm"} ${
        completed
          ? "border-emerald-400 bg-emerald-400 text-emerald-950 shadow-sm shadow-emerald-200"
          : "border-slate-300 bg-white text-transparent group-hover:border-emerald-400 group-hover:text-emerald-500"
      }`}
      aria-hidden="true"
    >
      ✓
    </span>
  );
}

function GroupCheckButton({ task, onToggle, t }) {
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); onToggle(task); }}
      onKeyDown={(event) => event.stopPropagation()}
      className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      aria-label={`${task.label} ${task.progress.completed ? t("task.completed") : t("task.markComplete")}`}
      aria-pressed={task.progress.completed}
    >
      <CheckIndicator task={task} />
    </button>
  );
}

function toggleOnKeyboard(event, task, onToggle) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onToggle(task);
}

function AvailabilityBadge({ task, t }) {
  if (task.availability !== "weekend") return null;
  const active = task.availabilityState === "active";
  const closing = task.availabilityState === "closing";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${closing ? "bg-rose-100 text-rose-700" : active ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{closing ? t("task.weekendClosing") : active ? t("task.weekendAvailable") : t("task.weekendUpcoming")}</span>;
}
function DeadlineBadge({ task, t }) {
  if (task.cadence === "custom" && task.dueAt) return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${task.dueOverdue ? "bg-rose-100 text-rose-700" : "bg-amber-50 text-amber-700"}`} title={formatUtcDeadline(task.dueAt, t.language)}>{task.dueOverdue ? t("task.overdue") : t("task.dueRemaining", { time: formatCompactRemaining(task.dueRemainingMs, t.language) })}</span>;
  if (!task.endsAt || task.remainingMs === null) return null;
  return <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700" title={formatUtcDeadline(task.endsAt, t.language)}>{t("task.deadlineRemaining", { time: formatCompactRemaining(task.remainingMs, t.language) })}</span>;
}
function CustomTimingBadges({ task, t }) {
  if (task.cadence !== "custom") return null;
  return <>{task.resetRemainingMs !== null ? <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">{t("task.resetRemaining", { time: formatCompactRemaining(task.resetRemainingMs, t.language) })}</span> : null}{task.visibleUntil && task.visibleRemainingMs !== null ? <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500" title={formatUtcDeadline(task.visibleUntil, t.language)}>{t("task.visibleRemaining", { time: formatCompactRemaining(task.visibleRemainingMs, t.language) })}</span> : null}</>;
}

function TabBadge({ name, tone }) {
  if (!name) return null;
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${tone.badge}`}>{name}</span>;
}

function TaskMeta({ task, tabName, tabTone: tone, t }) {
  const hasTiming = task.cadence === "custom" ? Boolean(task.dueAt || task.visibleUntil || task.nextResetAt) : Boolean(task.endsAt && task.remainingMs !== null);
  if (!tabName && !hasTiming) return null;
  return <span className="flex shrink-0 flex-col items-end gap-1"><TabBadge name={tabName} tone={tone} /><DeadlineBadge task={task} t={t} /><CustomTimingBadges task={task} t={t} /></span>;
}

function LeafTask({ task, onToggle, t, child = false, tabName = "", tabTone: tone = TAB_TONES[0] }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onToggle(task)}
      onKeyDown={(event) => toggleOnKeyboard(event, task, onToggle)}
      aria-label={`${task.label} ${task.progress.completed ? t("task.completed") : t("task.markComplete")}`}
      aria-pressed={task.progress.completed}
      className={`dashboard-leaf-task group flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 transition hover:border-emerald-300 hover:bg-emerald-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${task.progress.completed ? "border-emerald-200 bg-emerald-50/80" : child ? "border-emerald-100 bg-white/85" : "border-slate-200 bg-white"}`}
    >
      <CheckIndicator task={task} t={t} small={child} />
      <span className={`min-w-0 flex-1 break-words text-sm leading-tight ${task.progress.completed ? "text-slate-400 line-through" : "text-slate-700"}`}>{task.label}</span>
      <TaskMeta task={task} tabName={child ? "" : tabName} tabTone={tone} t={t} />
      <AvailabilityBadge task={task} t={t} />
      {task.progress.totalCount > 1 ? <span className="text-xs font-medium text-slate-400">{task.progress.completedCount}/{task.progress.totalCount}</span> : null}
    </div>
  );
}

function GroupTask({ task, onToggle, t, tabName = "", tabTone: tone = TAB_TONES[0] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="dashboard-group-task rounded-xl border border-emerald-100 bg-emerald-50/65 p-2.5 shadow-sm shadow-emerald-100/50">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          setExpanded((value) => !value);
        }}
        aria-label={`${task.label}を${expanded ? "折りたたむ" : "展開する"}`}
        aria-expanded={expanded}
        className="group flex cursor-pointer items-center gap-2 rounded-lg transition hover:bg-white/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        <GroupCheckButton task={task} onToggle={onToggle} t={t} />
        <span className={`text-xs text-emerald-600 transition ${expanded ? "rotate-90" : ""}`}>▶</span>
        <span className={`min-w-0 flex-1 break-words text-sm font-semibold leading-tight ${task.progress.completed ? "text-slate-400 line-through" : "text-slate-800"}`}>{task.label}</span>
        <TaskMeta task={task} tabName={tabName} tabTone={tone} t={t} />
        <AvailabilityBadge task={task} t={t} />
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-100">{task.progress.completedCount}/{task.progress.totalCount}</span>
      </div>
      {expanded ? <div className="mt-2 space-y-1.5 border-l border-emerald-200 pl-3">{task.children.map((child) => <LeafTask key={child.id} task={child} onToggle={onToggle} t={t} child />)}</div> : null}
    </div>
  );
}

function CadenceColumn({ title, tasks, tabs, summary, remainingMs, onToggle, t, tone }) {
  const [selectedTabId, setSelectedTabId] = useState("");
  const activeTabId = tabs.some((tab) => tab.id === selectedTabId) ? selectedTabId : "";
  const visibleTasks = activeTabId ? tasks.filter((task) => task.tabId === activeTabId) : tasks;
  const visibleSummary = activeTabId ? summarizeTasks(visibleTasks) : summary;
  const progressTone = tone === "weekly" ? "from-sky-400 to-cyan-300" : "from-emerald-400 to-lime-300";
  const textTone = tone === "weekly" ? "text-sky-700" : "text-emerald-700";
  return (
    <section className="dashboard-cadence-column h-full rounded-xl border border-slate-200 bg-white/75 p-3 shadow-sm shadow-slate-200/50">
      <div className="flex items-center justify-between gap-3">
        <div><div className="flex items-baseline gap-2"><h3 className="text-base font-semibold text-slate-900">{title}</h3><span className="text-xs text-slate-400">{visibleSummary.completed}/{visibleSummary.total}</span></div><p className="mt-0.5 text-xs font-medium text-slate-500">{remainingMs === null ? t("reset.customRule") : t("reset.remaining", { time: formatRemaining(remainingMs, t.language) })}</p></div>
        <span className={`text-base font-bold ${textTone}`}>{visibleSummary.percent}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full bg-gradient-to-r ${progressTone} transition-all`} style={{ width: `${visibleSummary.percent}%` }} /></div>
      <div className="mt-2 flex gap-1 overflow-x-auto pb-1"><button type="button" onClick={()=>setSelectedTabId("")} className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${!activeTabId?"bg-emerald-100 text-emerald-800":"bg-slate-100 text-slate-500"}`}>{t("task.allTab")}</button>{tabs.map((tab,index)=>{const tone=tabTone(index);return <button key={tab.id} type="button" onClick={()=>setSelectedTabId(tab.id)} className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${activeTabId===tab.id?tone.active:tone.idle}`}>{tab.name}</button>;})}</div>
      <div className="mt-3 space-y-1.5">
        {visibleTasks.map((task) => { const tabIndex = tabs.findIndex((tab) => tab.id === task.tabId); const tabName = !activeTabId && tabIndex >= 0 ? tabs[tabIndex].name : ""; const tone = tabTone(tabIndex); return task.children.length ? <GroupTask key={task.id} task={task} onToggle={onToggle} t={t} tabName={tabName} tabTone={tone} /> : <LeafTask key={task.id} task={task} onToggle={onToggle} t={t} tabName={tabName} tabTone={tone} />; })}
        {!visibleTasks.length ? <p className="rounded-lg border border-dashed border-emerald-200 bg-white/60 py-5 text-center text-sm text-emerald-700">{t("summary.empty")}</p> : null}
      </div>
    </section>
  );
}

export default function DashboardTasks({ daily, weekly, custom, dailyTabs, weeklyTabs, dailySummary, weeklySummary, customSummary, dailyResetMs, weeklyResetMs, onToggle, t }) {
  const [rightMode, setRightMode] = useState("weekly");
  const rightIsWeekly = rightMode === "weekly";
  return (
    <section className="dashboard-card dashboard-task-card flex h-full flex-col overflow-visible">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200">✓</span><h2 className="text-xl font-bold tracking-[0.12em] text-emerald-700">TASKS</h2></div>
        <a href={ROUTES.tasks} className="dashboard-link">{t("dashboard.openTasks")}</a>
      </div>
      <div className="grid flex-1 items-stretch gap-3 sm:grid-cols-2">
        <CadenceColumn title={t("summary.daily")} tasks={daily} tabs={dailyTabs} summary={dailySummary} remainingMs={dailyResetMs} onToggle={onToggle} t={t} tone="daily" />
        <div className="flex min-h-0 flex-col gap-1.5"><div className="dashboard-cadence-switch grid grid-cols-2 rounded-lg bg-slate-100 p-1"><button type="button" onClick={()=>setRightMode("weekly")} className={`rounded-md px-2 py-1 text-xs font-bold ${rightIsWeekly?"bg-white text-sky-700 shadow-sm":"text-slate-500"}`}>{t("summary.weekly")}</button><button type="button" onClick={()=>setRightMode("custom")} className={`rounded-md px-2 py-1 text-xs font-bold ${!rightIsWeekly?"bg-white text-violet-700 shadow-sm":"text-slate-500"}`}>{t("summary.custom")}</button></div><div className="min-h-0 flex-1"><CadenceColumn title={rightIsWeekly?t("summary.weekly"):t("summary.custom")} tasks={rightIsWeekly?weekly:custom} tabs={weeklyTabs} summary={rightIsWeekly?weeklySummary:customSummary} remainingMs={rightIsWeekly?weeklyResetMs:null} onToggle={onToggle} t={t} tone={rightIsWeekly?"weekly":"custom"} /></div></div>
      </div>
    </section>
  );
}
