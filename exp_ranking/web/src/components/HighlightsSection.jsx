import { ChevronDown, ChevronUp } from "lucide-react";
import TopGainHighlights from "../TopGainHighlights";

export default function HighlightsSection({
  characters,
  gainRankMaps,
  selectedId,
  onSelect,
  isFavorite,
  onToggleFavorite,
  showHighlights,
  onToggle,
  t,
}) {
  return (
    <section className="overflow-hidden rounded-md border border-slate-800">
      <button
        type="button"
        aria-expanded={showHighlights}
        onClick={onToggle}
        className="flex w-full items-center justify-between bg-slate-900/70 px-3 py-2 text-left transition hover:bg-slate-900"
      >
        <h2 className="text-sm font-semibold text-slate-200">TOP3</h2>
        <span className="flex items-center gap-2 text-xs text-slate-500">
          <span className="hidden sm:inline">{t(showHighlights ? "filter.clickToCollapse" : "filter.clickToExpand")}</span>
          {showHighlights ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
        </span>
      </button>
      {showHighlights ? (
        <div className="border-t border-slate-800 p-2">
          <TopGainHighlights
            characters={characters}
            gainRankMaps={gainRankMaps}
            selectedId={selectedId}
            onSelect={onSelect}
            isFavorite={isFavorite}
            onToggleFavorite={onToggleFavorite}
          />
        </div>
      ) : null}
    </section>
  );
}
