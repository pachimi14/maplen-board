import AppToolbar from "./AppToolbar.jsx";

export default function PageHeader({ active, title, description, actions, className = "" }) {
  return (
    <header className={`grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-start ${className}`}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      <div className="flex justify-start lg:col-start-2 lg:row-start-1 lg:justify-self-center">
        <AppToolbar active={active} />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 lg:col-start-3 lg:row-start-1 lg:justify-self-end">
        {actions}
      </div>
    </header>
  );
}