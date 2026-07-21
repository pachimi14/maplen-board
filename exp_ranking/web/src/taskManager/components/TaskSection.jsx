import { useState } from "react";
import { formatRemaining, formatUtcDeadline } from "../utils/format.js";

function NameEditor({ initialValue, onSave, onCancel, t, autoFocus = true }) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");
  function submit(event) {
    event.preventDefault();
    if (!value.trim()) {
      setError(t("form.required"));
      return;
    }
    const result = onSave(value.trim());
    if (!result?.ok) {
      setError(t("backup.saveFailed"));
      return;
    }
    onCancel();
  }
  return (
    <form onSubmit={submit} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <input autoFocus={autoFocus} value={value} onChange={(event) => { setValue(event.target.value); setError(""); }} className="field min-w-40 flex-1" aria-label={t("task.editName")} />
      <button type="submit" className="mini-button">{t("actions.save")}</button>
      <button type="button" onClick={onCancel} className="mini-button">{t("actions.cancel")}</button>
      {error ? <span className="w-full text-xs text-rose-600">{error}</span> : null}
    </form>
  );
}

function DeadlineEditor({ value, onSave, t }) {
  const initial = value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString().slice(0, 16) : "";
  const [input, setInput] = useState(initial);
  const [error, setError] = useState("");
  function submit(event) {
    event.preventDefault();
    const endsAt = input ? new Date(`${input}:00Z`).toISOString() : null;
    const result = onSave(endsAt);
    setError(result?.ok ? "" : t("backup.saveFailed"));
  }
  return <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2"><input type="datetime-local" value={input} onChange={(event) => setInput(event.target.value)} className="field max-w-60" aria-label={t("task.deadline")}/><span className="text-xs font-semibold text-slate-500">UTC</span><button type="submit" className="mini-button">{t("actions.save")}</button>{value?<button type="button" onClick={()=>{setInput("");onSave(null);}} className="mini-button text-rose-600">{t("task.removeDeadline")}</button>:null}{error?<span className="w-full text-xs text-rose-600">{error}</span>:null}</form>;
}

function FlexibleTimingEditor({ task, onSave, t }) {
  const [mode, setMode] = useState(task.resetRule?.mode || "none");
  const [firstAt, setFirstAt] = useState(task.resetRule?.firstAt?.slice(0, 16) || "");
  const [every, setEvery] = useState(String(task.resetRule?.every || 1));
  const [unit, setUnit] = useState(task.resetRule?.unit || "day");
  const [dueAt, setDueAt] = useState(task.dueAt?.slice(0, 16) || "");
  const [visibleUntil, setVisibleUntil] = useState(task.visibleUntil?.slice(0, 16) || "");
  const [error, setError] = useState("");
  const iso = (value) => value ? new Date(`${value}:00Z`).toISOString() : null;
  function submit(event) {
    event.preventDefault();
    const count = Number(every);
    if (mode !== "none" && !firstAt) { setError(t("form.resetRequired")); return; }
    if (mode === "interval" && (!Number.isInteger(count) || count < 1 || count > 365)) { setError(t("form.resetEveryInvalid")); return; }
    const resetRule = mode === "none" ? { mode: "none" } : mode === "once" ? { mode: "once", firstAt: iso(firstAt) } : { mode: "interval", firstAt: iso(firstAt), every: count, unit };
    const result = onSave({ resetRule, dueAt: iso(dueAt), visibleUntil: iso(visibleUntil) });
    setError(result?.ok ? "" : t("backup.saveFailed"));
  }
  return <form onSubmit={submit} className="mt-3 space-y-3 border-t border-slate-200 pt-3"><p className="text-xs font-semibold text-slate-700">{t("task.timingSettings")}</p><label className="block text-xs text-slate-600">{t("task.resetRule")}<select value={mode} onChange={(e)=>setMode(e.target.value)} className="field mt-1"><option value="none">{t("task.resetNone")}</option><option value="once">{t("task.resetOnce")}</option><option value="interval">{t("task.resetInterval")}</option></select></label>{mode!=="none"?<label className="block text-xs text-slate-600">{t("task.firstResetAt")}<input type="datetime-local" value={firstAt} onChange={(e)=>setFirstAt(e.target.value)} className="field mt-1"/><span className="ml-2">UTC</span></label>:null}{mode==="interval"?<div className="grid grid-cols-2 gap-2"><label className="text-xs text-slate-600">{t("task.resetEvery")}<input type="number" min="1" max="365" value={every} onChange={(e)=>setEvery(e.target.value)} className="field mt-1"/></label><label className="text-xs text-slate-600">{t("task.resetUnit")}<select value={unit} onChange={(e)=>setUnit(e.target.value)} className="field mt-1"><option value="day">{t("task.days")}</option><option value="week">{t("task.weeks")}</option></select></label></div>:null}<label className="block text-xs text-slate-600">{t("task.dueAt")}<input type="datetime-local" value={dueAt} onChange={(e)=>setDueAt(e.target.value)} className="field mt-1"/><span className="ml-2 text-slate-400">{t("task.dueAtHint")} · UTC</span></label><label className="block text-xs text-slate-600">{t("task.visibleUntil")}<input type="datetime-local" value={visibleUntil} onChange={(e)=>setVisibleUntil(e.target.value)} className="field mt-1"/><span className="ml-2 text-slate-400">{t("task.visibleUntilHint")} · UTC</span></label>{error?<p className="text-xs text-rose-600">{error}</p>:null}<button type="submit" className="mini-button">{t("actions.save")}</button></form>;
}
function DeadlineBadge({ task, t }) {
  if (!task.endsAt || task.remainingMs === null) return null;
  return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700" title={formatUtcDeadline(task.endsAt)}>{t("task.deadlineRemaining", { time: formatRemaining(task.remainingMs) })}</span>;
}

function TaskTabBar({ tabs, selectedId, onSelect, onAdd, onRename, onDelete, t }) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  function add(event) { event.preventDefault(); if (!name.trim()) return; const result = onAdd(name.trim()); if (result?.ok) setName(""); }
  function rename(event) { event.preventDefault(); if (!editingName.trim()) return; const result = onRename(editingId, editingName.trim()); if (result?.ok) setEditingId(null); }
  return <div className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50/35 p-3"><div className="flex gap-1.5 overflow-x-auto pb-1"><button type="button" onClick={()=>onSelect("")} className={`mini-button shrink-0 ${!selectedId?"border-emerald-300 bg-white text-emerald-700":""}`}>{t("task.allTab")}</button>{tabs.map(tab=><span key={tab.id} className="flex shrink-0 items-center"><button type="button" onClick={()=>onSelect(tab.id)} className={`mini-button rounded-r-none ${selectedId===tab.id?"border-emerald-300 bg-white text-emerald-700":""}`}>{tab.name}</button><button type="button" onClick={()=>{setEditingId(tab.id);setEditingName(tab.name);}} className="mini-button rounded-l-none border-l-0 px-2" aria-label={`${tab.name}を編集`}>✎</button></span>)}</div>{editingId?<form onSubmit={rename} className="mt-2 flex gap-2"><input autoFocus value={editingName} onChange={e=>setEditingName(e.target.value)} className="field min-w-0 flex-1"/><button className="mini-button" type="submit">{t("actions.save")}</button><button className="mini-button" type="button" onClick={()=>setEditingId(null)}>{t("actions.cancel")}</button><button className="mini-button text-rose-600" type="button" onClick={()=>{onDelete(editingId);setEditingId(null);onSelect("");}}>{t("actions.delete")}</button></form>:<form onSubmit={add} className="mt-2 flex gap-2"><input value={name} onChange={e=>setName(e.target.value)} placeholder={t("task.tabNamePlaceholder")} className="field min-w-0 flex-1"/><button type="submit" className="mini-button">＋ {t("task.addTab")}</button></form>}<p className="mt-1 text-[11px] text-slate-400">{t("task.tabEditHint")}</p></div>;
}

function ChildTaskForm({ taskId, onAdd, onCancel, t }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  function submit(event) {
    event.preventDefault();
    if (!title.trim()) {
      setError(t("task.childRequired"));
      return;
    }
    const result = onAdd(taskId, title.trim());
    if (!result.ok) {
      setError(t("backup.saveFailed"));
      return;
    }
    setTitle("");
    onCancel();
  }
  return (
    <form onSubmit={submit} className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
      <label className="block text-xs font-medium text-slate-700">
        {t("task.childName")}
        <input autoFocus value={title} onChange={(event) => { setTitle(event.target.value); setError(""); }} placeholder={t("task.childPlaceholder")} className="field mt-2" />
      </label>
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="mini-button">{t("actions.cancel")}</button>
        <button type="submit" className="primary-button">{t("task.addItem")}</button>
      </div>
    </form>
  );
}

function GroupContents({ task, editable, onRenameChild, onUpdateChildDeadline, onRemoveChild, onReorderChild, t }) {
  const [editingId, setEditingId] = useState(null);
  const [draggedId, setDraggedId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  function dragPosition(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }
  return (
    <ul className="mt-3 space-y-2 border-l-2 border-dashed border-slate-200 pl-4" onDragEnd={() => { setDraggedId(null); setDropTarget(null); }}>
      {task.children.map((child) => (
        <li
          key={child.id}
          onDragOver={editable && draggedId && draggedId !== child.id ? (event) => { event.preventDefault(); setDropTarget({ id: child.id, position: dragPosition(event) }); } : undefined}
          onDrop={editable && draggedId && draggedId !== child.id ? (event) => { event.preventDefault(); onReorderChild(task.id, draggedId, child.id, dragPosition(event)); setDraggedId(null); setDropTarget(null); } : undefined}
          className={`flex flex-wrap items-center gap-2 rounded-xl border bg-slate-50 p-2 ${dropTarget?.id === child.id ? (dropTarget.position === "before" ? "border-t-4 border-t-emerald-400" : "border-b-4 border-b-emerald-400") : "border-slate-200"}`}
        >
          {editable ? <span draggable onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", child.id); setDraggedId(child.id); }} className="cursor-grab select-none px-1 text-lg leading-none text-slate-400 active:cursor-grabbing" title={t("task.dragHandle")} aria-label={t("task.dragHandle")}>⠿</span> : null}
          {editingId === child.id ? (
            <NameEditor initialValue={child.label} onSave={(value) => { onRenameChild(task.id, child.id, value); setEditingId(null); }} onCancel={() => setEditingId(null)} t={t} />
          ) : (
            <>
              <span className="min-w-0 flex-1 break-words text-sm text-slate-700">{child.label}</span>
              <DeadlineBadge task={child} t={t} />
              {editable ? <button type="button" onClick={() => setEditingId(child.id)} className="mini-button">{t("actions.edit")}</button> : null}
              {editable ? <button type="button" onClick={() => onRemoveChild(task.id, child.id)} className="mini-button text-rose-600">{t("actions.delete")}</button> : null}
              {editable ? <details className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2"><summary className="cursor-pointer text-xs font-medium text-slate-600">{t("task.editDeadline")}</summary><DeadlineEditor value={child.endsAt} onSave={(endsAt) => onUpdateChildDeadline(task.id, child.id, endsAt)} t={t}/></details> : null}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
function TaskRow({ task, index, total, tabs, showTabBadge, dragState, onDragStart, onDragOver, onDrop, onDragEnd, onOverride, onAssignTab, onDelete, onMove, onAddChild, onRenameTask, onRenameChild, onUpdateTaskDeadline, onUpdateTaskTiming, onUpdateChildDeadline, onRemoveChild, onReorderChild, t }) {
  const [addingChild, setAddingChild] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const isGroup = task.children.length > 0;
  const tabName = showTabBadge && task.tabId ? tabs.find((tab) => tab.id === task.tabId)?.name : "";
  return (
    <li onDragOver={(event) => onDragOver(event, task.id)} onDrop={(event) => onDrop(event, task.id)} onDragEnd={onDragEnd} className={`rounded-2xl border px-3 py-2.5 transition ${dragState?.id === task.id ? (dragState.position === "before" ? "border-t-4 border-t-emerald-400" : "border-b-4 border-b-emerald-400") : task.hidden ? "border-dashed border-slate-300 bg-slate-100/70 opacity-70" : "border-slate-200 bg-white"}`}>
      <div role="button" tabIndex={0} onClick={() => setExpanded((value) => !value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setExpanded((value) => !value); } }} aria-expanded={expanded} className="flex cursor-pointer items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
        <span draggable onClick={(event) => event.stopPropagation()} onDragStart={(event) => onDragStart(event, task.id)} className="cursor-grab select-none px-1 text-lg leading-none text-slate-400 active:cursor-grabbing" title={t("task.dragHandle")} aria-label={t("task.dragHandle")}>⠿</span>
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs transition ${isGroup ? "bg-violet-50 text-violet-600" : "bg-slate-50 text-slate-400"}`}>{isGroup ? (expanded ? "⌃" : "⌄") : "•"}</span>
        <p className="min-w-0 flex-1 break-words text-sm font-semibold text-slate-900">{task.label}</p>
        {isGroup ? <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">{t("task.itemCount", { count: task.children.length })}</span> : null}
        {task.availability === "weekend" ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{t("task.weekendBadge")}</span> : null}
        <DeadlineBadge task={task} t={t} />
        {tabName ? <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">{tabName}</span> : null}
      </div>

      {expanded ? <div className="mt-3 border-t border-slate-100 pt-3">
        {editingTitle ? <NameEditor initialValue={task.label} onSave={(value) => onRenameTask(task.id, value)} onCancel={() => setEditingTitle(false)} t={t} /> : null}
        {isGroup ? <GroupContents task={task} editable={task.source === "custom"} onRenameChild={onRenameChild} onUpdateChildDeadline={onUpdateChildDeadline} onRemoveChild={onRemoveChild} onReorderChild={onReorderChild} t={t} /> : null}
        {task.source === "custom" ? <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setEditingTitle(true)} className="secondary-button">{t("task.editName")}</button>
          <button type="button" onClick={() => setAddingChild((value) => !value)} className="secondary-button">＋ {t("task.addItem")}</button>
          <button type="button" onClick={() => onDelete(task.id)} className="secondary-button text-rose-600">{t("task.delete")}</button>
        </div> : null}
        {addingChild ? <ChildTaskForm taskId={task.id} onAdd={onAddChild} onCancel={() => setAddingChild(false)} t={t} /> : null}
        <div className="mt-3"><p className="mb-2 text-xs font-semibold text-slate-600">{t("task.belongsToTab")}</p><div className="flex flex-wrap gap-1.5"><button type="button" onClick={()=>onAssignTab(task.id,null)} className={`mini-button ${!task.tabId?"border-emerald-300 bg-emerald-50 text-emerald-700":""}`}>{t("task.unclassifiedShort")}</button>{tabs.map(tab=><button key={tab.id} type="button" onClick={()=>onAssignTab(task.id,tab.id)} className={`mini-button ${task.tabId===tab.id?"border-emerald-300 bg-emerald-50 text-emerald-700":""}`}>{tab.name}</button>)}</div></div>
        <details className="mt-3 rounded-xl bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-medium text-slate-700">{t("task.otherSettings")}</summary><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={index === 0} onClick={() => onMove(task, -1)} className="mini-button disabled:opacity-30">↑ {t("task.moveUp")}</button><button type="button" disabled={index === total - 1} onClick={() => onMove(task, 1)} className="mini-button disabled:opacity-30">↓ {t("task.moveDown")}</button><button type="button" onClick={() => onOverride(task.id, { hidden: !task.hidden })} className="mini-button">{task.hidden ? t("task.restore") : t("task.hide")}</button>{task.cadence === "weekly" ? <button type="button" onClick={() => onOverride(task.id, { availability: task.availability === "weekend" ? "always" : "weekend" })} className={`mini-button ${task.availability === "weekend" ? "border-amber-300 bg-amber-50 text-amber-700" : ""}`}>{task.availability === "weekend" ? t("task.weekendOn") : t("task.weekendOff")}</button> : null}</div>{task.source === "custom" && task.cadence === "custom" ? <FlexibleTimingEditor task={task} onSave={(patch)=>onUpdateTaskTiming(task.id,patch)} t={t}/> : task.source === "custom" ? <div className="mt-3 border-t border-slate-200 pt-3"><p className="text-xs font-medium text-slate-700">{t("task.deadline")}</p><DeadlineEditor value={task.endsAt} onSave={(endsAt) => onUpdateTaskDeadline(task.id, endsAt)} t={t}/></div> : null}</details>
      </div> : null}
    </li>
  );
}
export default function TaskSection({ title, rule, remainingMs, tasks, tabs, onAdd, onAddTab, onRenameTab, onDeleteTab, onAssignTab, onOverride, onDelete, onMove, onReorder, onAddChild, onRenameTask, onRenameChild, onUpdateTaskDeadline, onUpdateTaskTiming, onUpdateChildDeadline, onRemoveChild, onReorderChild, t }) {
  const [selectedTabId, setSelectedTabId] = useState("");
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const activeTabId = tabs.some((tab) => tab.id === selectedTabId) ? selectedTabId : "";
  const visibleTasks = activeTabId ? tasks.filter((task) => task.tabId === activeTabId) : tasks;

  function dragPosition(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }
  function beginDrag(event, taskId) {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", taskId);
    setDraggedTaskId(taskId);
  }
  function dragOver(event, taskId) {
    if (!draggedTaskId || draggedTaskId === taskId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({ id: taskId, position: dragPosition(event) });
  }
  function drop(event, taskId) {
    if (!draggedTaskId || draggedTaskId === taskId) return;
    event.preventDefault();
    onReorder(visibleTasks, draggedTaskId, taskId, dragPosition(event));
    setDraggedTaskId(null);
    setDropTarget(null);
  }
  function endDrag() {
    setDraggedTaskId(null);
    setDropTarget(null);
  }

  return (
    <section className="panel-card">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">{rule}</p><h2 className="mt-2 text-xl font-semibold text-slate-900">{title}</h2>{remainingMs === null ? null : <p className="mt-1 text-sm font-semibold text-emerald-700">{t("reset.remaining", { time: formatRemaining(remainingMs) })}</p>}<p className="mt-1 text-xs text-slate-500">{t("task.taskCount", { count: visibleTasks.length })}</p></div><button type="button" onClick={onAdd} className="primary-button">＋ {t("task.add")}</button></div>
      <TaskTabBar tabs={tabs} selectedId={activeTabId} onSelect={setSelectedTabId} onAdd={onAddTab} onRename={onRenameTab} onDelete={onDeleteTab} t={t}/>
      {visibleTasks.length ? <ul className="space-y-3">{visibleTasks.map((task,index)=><TaskRow key={task.id} task={task} index={index} total={visibleTasks.length} tabs={tabs} showTabBadge={!activeTabId} dragState={dropTarget} onDragStart={beginDrag} onDragOver={dragOver} onDrop={drop} onDragEnd={endDrag} onOverride={onOverride} onAssignTab={onAssignTab} onDelete={onDelete} onMove={(current,direction)=>onMove(visibleTasks,current,direction)} onAddChild={onAddChild} onRenameTask={onRenameTask} onRenameChild={onRenameChild} onUpdateTaskDeadline={onUpdateTaskDeadline} onUpdateTaskTiming={onUpdateTaskTiming} onUpdateChildDeadline={onUpdateChildDeadline} onRemoveChild={onRemoveChild} onReorderChild={onReorderChild} t={t}/>)}</ul>:<div className="rounded-2xl border border-dashed border-slate-300 px-5 py-8 text-center"><p className="font-medium text-slate-700">{t("task.emptyTitle")}</p><p className="mt-2 text-sm text-slate-500">{t("task.emptyHint")}</p></div>}
    </section>
  );
}
