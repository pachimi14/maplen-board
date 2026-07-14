import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { JOB_TAXONOMY } from "../jobCategories";
import ShareLinkButton from "./ShareLinkButton";

const SORT_OPTIONS = [
  { key: "rank", labelKey: "sort.levelRank" },
  { key: "daily", labelKey: "period.dailyShort" },
  { key: "weekly", labelKey: "period.weeklyShort" },
  { key: "monthly", labelKey: "period.monthlyShort" },
];

export default function RankingControls({
  target,
  sortKey,
  setSortKey,
  showFilterSection,
  showFilters,
  setShowFilters,
  worldOptions,
  worldFilter,
  setWorldFilter,
  jobAlliance,
  setJobAlliance,
  jobBranch,
  setJobBranch,
  jobFilter,
  setJobFilter,
  visibleJobBranches,
  visibleJobOptions,
  minLevel,
  setMinLevel,
  gainFilterPeriod,
  setGainFilterPeriod,
  minGainBillions,
  setMinGainBillions,
  periodLabels,
  t,
  translateAlliance,
  translateBranch,
}) {
  if (!target) {
    return null;
  }

  return createPortal(
    (<>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-800 bg-slate-900/30 p-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-slate-500">{t("filter.sort")}</span>
          {SORT_OPTIONS.map((option) => (
            <Button key={option.key} type="button" size="sm" variant={sortKey === option.key ? "default" : "outline"} className="h-8 border-slate-700" onClick={() => setSortKey(option.key)}>
              {t(option.labelKey)}
            </Button>
          ))}
        </div>
        <div className="ml-auto">
          <ShareLinkButton t={t} />
        </div>
      </div>

      {showFilterSection ? (
      <div className="overflow-hidden rounded-md border border-slate-800">
        <button
          type="button"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((current) => !current)}
          className="flex w-full items-center justify-between bg-slate-900/70 px-3 py-2 text-left transition hover:bg-slate-900"
        >
          <h2 className="text-sm font-semibold text-slate-200">{t("filter.title")}</h2>
          <span className="flex items-center gap-2 text-xs text-slate-500">
            <span className="hidden sm:inline">{t(showFilters ? "filter.clickToCollapse" : "filter.clickToExpand")}</span>
            {showFilters ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
          </span>
        </button>
        {showFilters ? (
        <div className="divide-y divide-slate-800 border-t border-slate-800">
          <div className="bg-slate-900/20 p-2">
            <div className="space-y-1.5">
              <span className="block text-xs text-slate-400">{t("filter.server")}</span>
              <div className="flex flex-wrap gap-1.5">
                {worldOptions.map((world) => (
                  <Button key={world} type="button" size="sm" variant={worldFilter === world ? "default" : "outline"} className="h-8 border-slate-700" onClick={() => setWorldFilter(world)}>
                    {world === "all" ? t("view.allServers") : world}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-1.5 p-2">
            <span className="text-xs text-slate-400">{t("filter.job")}</span>
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" variant={jobAlliance === "all" ? "default" : "outline"} className="border-slate-700" onClick={() => { setJobAlliance("all"); setJobFilter("all"); }}>
                {t("filter.allJobs")}
              </Button>
              {JOB_TAXONOMY.map(({ alliance }) => (
                <Button key={alliance} type="button" size="sm" variant={jobAlliance === alliance ? "default" : "outline"} className="border-slate-700" onClick={() => { setJobAlliance(alliance); setJobFilter("all"); if (alliance === "冒険家") setJobBranch("all"); }}>
                  {translateAlliance(alliance)}
                </Button>
              ))}
            </div>
            {visibleJobBranches.length ? (
              <div className="flex flex-wrap gap-1.5 border-l-2 border-slate-700 pl-2">
                <Button type="button" size="sm" variant={jobBranch === "all" ? "secondary" : "outline"} className="border-slate-700" onClick={() => { setJobBranch("all"); setJobFilter("all"); }}>
                  {t("filter.allJobs")}
                </Button>
                {visibleJobBranches.map(({ branch }) => (
                  <Button key={branch} type="button" size="sm" variant={jobBranch === branch ? "secondary" : "outline"} className="border-slate-700" onClick={() => { setJobBranch(branch); setJobFilter("all"); }}>
                    {translateBranch(branch)}
                  </Button>
                ))}
              </div>
            ) : null}
            {visibleJobOptions.length && !(jobAlliance === "冒険家" && jobBranch === "all") ? (
              <div className="flex flex-wrap gap-1.5 border-l-2 border-cyan-700/60 pl-2">
                {visibleJobOptions.map((job) => (
                  <Button key={job} type="button" size="sm" variant={jobFilter === job ? "default" : "outline"} className="border-slate-700" onClick={() => setJobFilter(job)}>
                    {job}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-2 bg-slate-900/30 p-2">
            <label className="mr-2 block w-48 text-xs text-slate-400">
              <span className="mb-1 block">{t("filter.minLevel")}</span>
              <Input type="number" min="225" value={minLevel} onChange={(event) => setMinLevel(event.target.value)} onBlur={() => { if (minLevel === "") setMinLevel("225"); }} className="h-8 bg-slate-900 border-slate-700" />
            </label>
            <div className="space-y-1">
              <span className="block text-xs text-slate-400">{t("filter.minGain")}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {["daily", "weekly", "monthly"].map((period) => (
                  <Button key={period} type="button" size="sm" variant={gainFilterPeriod === period ? "default" : "outline"} className="border-slate-700" onClick={() => setGainFilterPeriod(period)}>
                    {periodLabels[period]}
                  </Button>
                ))}
                <Input inputMode="decimal" value={minGainBillions} onChange={(event) => setMinGainBillions(event.target.value)} placeholder="0 B" className="h-8 w-32 bg-slate-900 border-slate-700" />
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto flex h-8 shrink-0 flex-row items-center gap-1.5 whitespace-nowrap border-slate-700 bg-transparent px-3 text-slate-300 hover:bg-slate-800 hover:text-white"
              aria-label={t("filter.reset")}
              title={t("filter.reset")}
              onClick={() => {
                setWorldFilter("all");
                setJobFilter("all");
                setJobAlliance("all");
                setJobBranch("all");
                setMinLevel("225");
                setGainFilterPeriod("daily");
                setMinGainBillions("");
              }}
            >
              <RotateCcw size={15} className="shrink-0" />
              {t("filter.reset")}
            </Button>
          </div>
        </div>
        ) : null}
      </div>
      ) : null}
    </>),
    target,
  );
}
