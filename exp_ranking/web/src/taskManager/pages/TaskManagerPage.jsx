import { useEffect, useMemo, useState } from "react";
import preset from "../data/presets.json";
import AddTaskDialog from "../components/AddTaskDialog.jsx";
import BackupDialog from "../components/BackupDialog.jsx";
import EventManagementSection from "../components/EventManagementSection.jsx";
import TaskSection from "../components/TaskSection.jsx";
import NotificationSettings from "../components/NotificationSettings.jsx";
import { mergeTasks } from "../domain/mergeTasks.js";
import AppToolbar from "../components/AppToolbar.jsx";
import { getResetSnapshot } from "../domain/reset.js";
import { buildNotificationSnapshot, normalizeNotificationSettings } from "../domain/notificationModel.js";
import { instantiateTaskTemplate, listTaskTemplates } from "../domain/taskTemplates.js";
import {
  addChildTask,
  addTaskTab,
  addCustomTask,
  removeChildTask,
  removeTaskTab,
  removeCustomTask,
  reorderChildTasks,
  reorderItems,
  renameTaskTab,
  listTaskTabs,
  setTaskOverride,
  updateChildTask,
  updateCustomTask,
} from "../domain/taskModel.js";
import { useTranslation } from "../i18n/useTaskTranslation.jsx";
import { useTaskStore } from "../storage/useTaskStore.js";

function uniqueId(prefix) {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export default function TaskManagerPage() {
  const { t, language } = useTranslation();
  const { state, status, update, replace } = useTaskStore(preset);
  const [now, setNow] = useState(() => new Date());
  const [addCadence, setAddCadence] = useState(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationConnection, setNotificationConnection] = useState("loading");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

const view = useMemo(
    () => mergeTasks(preset, state, now, { language, includeHidden: true }),
    [state, now, language],
  );
  const resetSnapshot = useMemo(() => getResetSnapshot(now), [now]);
  const templates = useMemo(() => listTaskTemplates(preset, addCadence, language, now), [addCadence, now, language]);
  const taskTabs = useMemo(() => listTaskTabs(state), [state]);
  const notificationSnapshot = useMemo(() => buildNotificationSnapshot(view, state.notificationSettings), [view, state.notificationSettings]);
  const statusMessage = ["corrupt", "unsupportedVersion", "storageError"].includes(status)
    ? t(`status.${status}`)
    : "";

  function saveMutation(mutate) {
    const result = update(mutate);
    setOperationError(result.ok ? "" : t("backup.saveFailed"));
    return result;
  }

  function addTask(input) {
    const task = input.kind === "template"
      ? instantiateTaskTemplate(input.template, uniqueId, new Date())
      : {
          id: uniqueId("user"),
          title: input.title,
          cadence: input.cadence,
          notify: input.notify,
          availability: input.availability || "always",
          resetRule: input.resetRule || { mode: "none" },
          dueAt: input.dueAt || null,
          visibleUntil: input.visibleUntil || null,
          assignment: { mode: "shared", historyKeys: [] },
          children: [],
          createdAt: new Date().toISOString(),
        };
    const result = saveMutation((current) => addCustomTask(current, task).state);
    if (result.ok) setAddCadence(null);
    return result;
  }

  function addChild(parentId, title) {
    return saveMutation((current) => addChildTask(current, parentId, {
      id: uniqueId("item"),
      title,
      createdAt: new Date().toISOString(),
    }).state);
  }

  function moveTask(tasks, task, direction) {
    const index = tasks.findIndex((item) => item.id === task.id);
    const neighbor = tasks[index + direction];
    if (!neighbor) return;
    saveMutation((current) => {
      const withCurrent = setTaskOverride(current, task.id, { order: neighbor.order });
      return setTaskOverride(withCurrent, neighbor.id, { order: task.order });
    });
  }
  function reorderTasks(tasks, sourceId, targetId, position) {
    const reordered = reorderItems(tasks, sourceId, targetId, position);
    if (reordered === tasks) return;
    const orderSlots = tasks.map((task) => task.order).sort((a, b) => a - b);
    saveMutation((current) => reordered.reduce(
      (next, task, index) => setTaskOverride(next, task.id, { order: orderSlots[index] }),
      current,
    ));
  }

  function changeNotificationSettings(settings) {
    saveMutation((current) => ({ ...current, notificationSettings: normalizeNotificationSettings(settings) }));
  }

  function setCustomNotification(task, enabled, localValue) {
    saveMutation((current) => {
      const custom = { ...current.notificationSettings.custom };
      if (!enabled) {
        delete custom[task.id];
      } else {
        let scheduledAt;
        if (localValue) {
          scheduledAt = new Date(localValue).toISOString();
        } else {
          const next = new Date(Date.now() + 15 * 60000);
          next.setMinutes(Math.ceil(next.getMinutes() / 15) * 15, 0, 0);
          scheduledAt = next.toISOString();
        }
        custom[task.id] = { enabled: true, scheduledAt };
      }
      const notificationSettings = normalizeNotificationSettings({ ...current.notificationSettings, custom });
      return setTaskOverride({ ...current, notificationSettings }, task.id, { notify: enabled });
    });
  }
  const commonProps = {
    onOverride: (taskId, patch) => saveMutation((current) => setTaskOverride(current, taskId, patch)),
    onAddTab: (name) => saveMutation((current) => addTaskTab(current, { id: uniqueId("tab"), name, createdAt: new Date().toISOString() }).state),
    onRenameTab: (tabId, name) => saveMutation((current) => renameTaskTab(current, tabId, name).state),
    onDeleteTab: (tabId) => saveMutation((current) => removeTaskTab(current, tabId).state),
    onAssignTab: (taskId, tabId) => saveMutation((current) => setTaskOverride(current, taskId, { tabId })),
    onDelete: (taskId) => saveMutation((current) => removeCustomTask(current, taskId).state),
    onMove: moveTask,
    onReorder: reorderTasks,
    onReorderChild: (parentId, sourceId, targetId, position) => saveMutation((current) => reorderChildTasks(current, parentId, sourceId, targetId, position).state),
    onAddChild: addChild,
    onRenameTask: (taskId, title) => saveMutation((current) => updateCustomTask(current, taskId, { title }).state),
    onRenameChild: (parentId, childId, title) => saveMutation((current) => updateChildTask(current, parentId, childId, { title }).state),
    onUpdateTaskDeadline: (taskId, endsAt) => saveMutation((current) => updateCustomTask(current, taskId, { endsAt }).state),
    onUpdateTaskTiming: (taskId, patch) => saveMutation((current) => updateCustomTask(current, taskId, patch).state),
    onUpdateChildDeadline: (parentId, childId, endsAt) => saveMutation((current) => updateChildTask(current, parentId, childId, { endsAt }).state),
    onRemoveChild: (parentId, childId) => saveMutation((current) => removeChildTask(current, parentId, childId).state),
    t,
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t("nav.tasks")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("task.configurationHint")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2"><AppToolbar active="tasks" /><button type="button" onClick={() => setNotificationOpen(true)} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold shadow-sm transition ${notificationConnection === "connected" ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-rose-300 bg-rose-50 text-rose-700 ring-2 ring-rose-200 hover:bg-rose-100"}`}><span aria-hidden="true">🔔</span><span>{t("notification.toolbar")}</span><span className={`rounded-full px-2 py-0.5 text-xs ${notificationConnection === "connected" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>{notificationConnection === "connected" ? t("notification.connected") : notificationConnection === "loading" ? t("notification.checking") : notificationConnection === "unavailable" ? t("notification.connectionError") : t("notification.notConnected")}</span></button><button type="button" onClick={() => setBackupOpen(true)} className="secondary-button">{t("actions.data")}</button></div>
      </section>
      {statusMessage || operationError ? <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">{statusMessage || operationError}</div> : null}
      <section className="grid items-start gap-6 lg:grid-cols-2">
        <TaskSection cadence="daily" tabs={taskTabs} title={t("task.daily")} rule={t("reset.dailyRule")} remainingMs={resetSnapshot.daily.remainingMs} tasks={view.daily} onAdd={() => setAddCadence("daily")} {...commonProps} />
        <TaskSection cadence="weekly" tabs={taskTabs} title={t("task.weekly")} rule={t("reset.weeklyRule")} remainingMs={resetSnapshot.weekly.remainingMs} tasks={view.weekly} onAdd={() => setAddCadence("weekly")} {...commonProps} />
        <TaskSection cadence="custom" tabs={taskTabs} title={t("task.customCadence")} rule={t("reset.customRule")} remainingMs={null} tasks={view.custom} onAdd={() => setAddCadence("custom")} {...commonProps} />
        <EventManagementSection templates={preset.eventTemplates} t={t} language={language} />
      </section>
      <NotificationSettings open={notificationOpen} onClose={() => setNotificationOpen(false)} onConnectionChange={setNotificationConnection} settings={state.notificationSettings} customTasks={view.custom} snapshot={notificationSnapshot} onChange={changeNotificationSettings} onSetCustomRule={setCustomNotification} t={t} />
      <AddTaskDialog open={Boolean(addCadence)} fixedCadence={addCadence} templates={templates} onClose={() => setAddCadence(null)} onSubmit={addTask} t={t} />
      <BackupDialog open={backupOpen} onClose={() => setBackupOpen(false)} state={state} onImport={replace} t={t} />
    </main>
  );
}
