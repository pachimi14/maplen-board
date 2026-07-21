import { formatRemaining, formatUtcDeadline } from "../utils/format.js";

export default function EventPanel({ events, t, compact = false }) {
  return (
    <section className="panel-card">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-600">EVENT</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-900">{t("event.title")}</h2>
        </div>
        <span className="text-sm text-slate-500">{events.length}</span>
      </div>
      {events.length ? (
        <div className={`grid gap-3 ${compact ? "" : "md:grid-cols-2"}`}>
          {events.map((event) => (
            <article key={event.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className={`rounded-full px-2.5 py-1 text-xs ${event.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-cyan-100 text-cyan-700"}`}>
                    {t(`event.${event.status}`)}
                  </span>
                  <h3 className="mt-3 font-medium text-slate-900">{event.label}</h3>
                  {event.note ? <p className="mt-2 line-clamp-2 text-xs leading-4 text-slate-500">{event.note}</p> : null}
                </div>
                <p className="text-sm font-semibold text-slate-700">{formatRemaining(event.remainingMs)}</p>
              </div>
              <p className="mt-4 text-xs text-slate-500">{t("event.deadline", { date: formatUtcDeadline(event.finalDeadlineAt) })}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-8 text-center">
          <p className="font-medium text-slate-700">{t("event.emptyTitle")}</p>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-500">{t("event.emptyHint")}</p>
        </div>
      )}
    </section>
  );
}
