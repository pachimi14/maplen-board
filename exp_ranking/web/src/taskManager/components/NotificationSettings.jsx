import { useEffect, useMemo, useState } from "react";
import { createNotificationSource } from "../integrations/notificationSource.js";

const source = createNotificationSource();
const timeOptions = Array.from({ length: 96 }, (_, index) => `${String(Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`);

function toLocalInput(value) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export default function NotificationSettings({ open, onClose, onConnectionChange, settings, customTasks, snapshot, onChange, onSetCustomRule, t }) {
  const [connection, setConnection] = useState({ status: "loading" });
  const [syncStatus, setSyncStatus] = useState("");
  const [lastSyncedSnapshot, setLastSyncedSnapshot] = useState("");
  const browserTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);

  useEffect(() => {
    let active = true;
    source.status().then((user) => { if (active) setConnection({ status: "connected", user }); }).catch((error) => { if (active) setConnection({ status: error.status === 401 ? "disconnected" : "unavailable" }); });
    return () => { active = false; };
  }, []);

  useEffect(() => { onConnectionChange?.(connection.status); }, [connection.status, onConnectionChange]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  useEffect(() => {
    if (settings.timeZone === "UTC" && browserTimeZone !== "UTC") onChange({ ...settings, timeZone: browserTimeZone });
  }, [browserTimeZone, onChange, settings]);

  useEffect(() => {
    if (connection.status !== "connected") return;
    syncNow();
  }, [connection.status]);

  async function syncNow() {
    const serialized = JSON.stringify(snapshot);
    setSyncStatus("syncing");
    try {
      await source.sync(snapshot);
      setLastSyncedSnapshot(serialized);
      setSyncStatus("synced");
    } catch {
      setSyncStatus("failed");
    }
  }

  function update(key, patch) {
    onChange({ ...settings, [key]: { ...settings[key], ...patch } });
  }

  async function disconnect() {
    try { await source.disconnect(); setConnection({ status: "disconnected" }); } catch { setSyncStatus("failed"); }
  }

  function connect() {
    window.location.assign(source.connectUrl(`${window.location.origin}${window.location.pathname}#/tasks`));
  }

  if (!open) return null;
  const customCount = Object.keys(settings.custom).length;
  const hasUnsavedChanges = JSON.stringify(snapshot) !== lastSyncedSnapshot;

  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 p-4 pt-[8vh] backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="notification-dialog-title" className="panel-card w-full max-w-4xl shadow-2xl">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div><p className="text-xs font-bold tracking-[0.18em] text-indigo-600">DISCORD</p><h2 id="notification-dialog-title" className="mt-1 text-xl font-semibold text-slate-900">{t("notification.title")}</h2><p className="mt-1 text-sm text-slate-500">{t("notification.hint")}</p></div>
        <div className="flex flex-wrap items-center justify-end gap-2">{connection.status === "connected" ? <><span className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700">{connection.user.username}</span><button type="button" onClick={disconnect} className="mini-button">{t("notification.disconnect")}</button></> : <button type="button" onClick={connect} disabled={connection.status === "loading" || connection.status === "unavailable"} className="primary-button">{t("notification.connect")}</button>}<button type="button" onClick={onClose} className="mini-button" aria-label={t("actions.close")}>×</button></div>
      </div>
      {connection.status === "disconnected" ? <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{t("notification.notConnectedHint")}</p> : null}
      {connection.status === "unavailable" ? <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{t("notification.unavailable")}</p> : null}
      {connection.user?.lastError ? <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{t("notification.deliveryFailed")}</p> : null}
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"><label className="flex items-center gap-2 font-semibold text-slate-800"><input type="checkbox" checked={settings.daily.enabled} onChange={(event) => update("daily", { enabled: event.target.checked })}/>{t("notification.daily")}</label><select className="field mt-3" value={settings.daily.time} onChange={(event) => update("daily", { time: event.target.value })}>{timeOptions.map((time) => <option key={time}>{time}</option>)}</select></div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"><label className="flex items-center gap-2 font-semibold text-slate-800"><input type="checkbox" checked={settings.weekly.enabled} onChange={(event) => update("weekly", { enabled: event.target.checked })}/>{t("notification.weekly")}</label><div className="mt-3 grid grid-cols-2 gap-2"><select className="field" value={settings.weekly.weekday} onChange={(event) => update("weekly", { weekday: Number(event.target.value) })}>{t("schedule.weekdays").map((day, index) => <option value={index} key={day}>{day}</option>)}</select><select className="field" value={settings.weekly.time} onChange={(event) => update("weekly", { time: event.target.value })}>{timeOptions.map((time) => <option key={time}>{time}</option>)}</select></div></div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"><p className="font-semibold text-slate-800">{t("notification.timeZone")}</p><p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm text-slate-600">{settings.timeZone}</p><p className="mt-2 text-xs text-slate-400">{t("notification.quarterHour")}</p></div>
      </div>
      <div className="mt-4 rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between"><h3 className="font-semibold text-slate-800">{t("notification.custom")}</h3><span className="text-xs text-slate-500">{customCount}/10</span></div><div className="mt-3 grid gap-2 md:grid-cols-2">{customTasks.map((task) => { const rule = settings.custom[task.id]; return <label key={task.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2.5"><input type="checkbox" checked={Boolean(rule)} disabled={!rule && customCount >= 10} onChange={(event) => onSetCustomRule(task, event.target.checked, null)}/><span className="min-w-0 flex-1 text-sm font-medium text-slate-700">{task.label}</span>{rule ? <input type="datetime-local" step="900" value={toLocalInput(rule.scheduledAt)} onChange={(event) => onSetCustomRule(task, true, event.target.value)} className="field max-w-56"/> : null}</label>; })}{!customTasks.length ? <p className="text-sm text-slate-400">{t("notification.customEmpty")}</p> : null}</div></div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className={`text-sm ${hasUnsavedChanges && connection.status === "connected" ? "font-semibold text-amber-700" : "text-slate-500"}`}>{syncStatus === "syncing" ? t("notification.syncing") : syncStatus === "failed" ? t("notification.syncFailed") : hasUnsavedChanges && connection.status === "connected" ? t("notification.unsaved") : connection.status === "connected" ? t("notification.synced") : t("notification.connectHint")}</p><button type="button" onClick={syncNow} disabled={connection.status !== "connected" || syncStatus === "syncing" || !hasUnsavedChanges} className="primary-button disabled:cursor-not-allowed disabled:opacity-40">{syncStatus === "syncing" ? t("notification.saving") : t("notification.save")}</button></div>
    </section>
  </div>;
}
