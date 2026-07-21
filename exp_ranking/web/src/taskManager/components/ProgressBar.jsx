export default function ProgressBar({ percent, label }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span>{label}</span>
        <span className="font-semibold text-slate-800">{percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
