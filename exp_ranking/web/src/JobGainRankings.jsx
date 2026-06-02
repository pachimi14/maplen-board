import React, { useEffect, useMemo, useState } from "react";
import FavoriteStar from "./FavoriteStar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import {
  categorizeJobRankings,
  JOB_ALLIANCES,
  JOB_TAXONOMY,
} from "./jobCategories";
import {
  buildGainRankingByJob,
  formatExp,
  formatLevelExp,
  GAIN_PERIOD_LABELS,
  gainRankClass,
  getGainAmount,
} from "./rankingUtils";

const TOP_PER_JOB = 5;

function allianceHasMembers(allianceEntry) {
  return allianceEntry.branches.some((branch) => branch.jobs.length > 0);
}

export default function JobGainRankings({
  characters,
  period,
  selectedId,
  onSelect,
  isFavorite,
  onToggleFavorite,
  expandedJob,
  onExpandJob,
}) {
  const [jobQuery, setJobQuery] = useState("");
  const [alliance, setAlliance] = useState("冒険家");
  const [branch, setBranch] = useState("戦士");
  const periodLabel = GAIN_PERIOD_LABELS[period] ?? period;

  const flatGroups = useMemo(
    () => buildGainRankingByJob(characters, period, TOP_PER_JOB),
    [characters, period]
  );

  const { alliances, otherJobs } = useMemo(
    () => categorizeJobRankings(flatGroups),
    [flatGroups]
  );

  const allianceEntry = useMemo(
    () => alliances.find((entry) => entry.alliance === alliance) ?? alliances[0],
    [alliances, alliance]
  );

  const isAdventurer = alliance === "冒険家";
  const branchNames = useMemo(() => {
    if (!isAdventurer || !allianceEntry) {
      return [];
    }
    return allianceEntry.branches.map((entry) => entry.branch);
  }, [isAdventurer, allianceEntry]);

  useEffect(() => {
    const firstWithData = alliances.find(allianceHasMembers);
    if (!firstWithData) {
      return;
    }
    setAlliance(firstWithData.alliance);
    if (firstWithData.alliance === "冒険家") {
      const firstBranch = firstWithData.branches.find((b) => b.jobs.length > 0);
      if (firstBranch?.branch) {
        setBranch(firstBranch.branch);
      }
    }
  }, [period]);

  useEffect(() => {
    const current = alliances.find((entry) => entry.alliance === alliance);
    if (current && allianceHasMembers(current)) {
      if (alliance === "冒険家") {
        const branchEntry = current.branches.find((entry) => entry.branch === branch);
        if (branchEntry?.jobs.length) {
          return;
        }
        const firstBranch = current.branches.find((entry) => entry.jobs.length > 0);
        if (firstBranch?.branch) {
          setBranch(firstBranch.branch);
        }
      }
      return;
    }
    const firstWithData = alliances.find(allianceHasMembers);
    if (!firstWithData) {
      return;
    }
    setAlliance(firstWithData.alliance);
    if (firstWithData.alliance === "冒険家") {
      const firstBranch = firstWithData.branches.find((entry) => entry.jobs.length > 0);
      if (firstBranch?.branch) {
        setBranch(firstBranch.branch);
      }
    }
  }, [alliances]);

  useEffect(() => {
    if (!isAdventurer) {
      return;
    }
    if (branchNames.includes(branch)) {
      return;
    }
    const first = branchNames[0];
    if (first) {
      setBranch(first);
    }
  }, [isAdventurer, branchNames, branch]);

  const visibleJobs = useMemo(() => {
    if (!allianceEntry) {
      return [];
    }
    if (isAdventurer) {
      const branchEntry = allianceEntry.branches.find((entry) => entry.branch === branch);
      return branchEntry?.jobs ?? [];
    }
    return allianceEntry.branches.flatMap((entry) => entry.jobs);
  }, [allianceEntry, isAdventurer, branch]);

  const filteredJobs = useMemo(() => {
    const lower = jobQuery.trim().toLowerCase();
    if (!lower) {
      return visibleJobs;
    }
    return visibleJobs.filter((group) => group.job.toLowerCase().includes(lower));
  }, [visibleJobs, jobQuery]);

  const expandedGroup = useMemo(() => {
    if (!expandedJob) {
      return null;
    }
    return flatGroups.find((group) => group.job === expandedJob) ?? null;
  }, [flatGroups, expandedJob]);

  const filteredOtherJobs = useMemo(() => {
    const lower = jobQuery.trim().toLowerCase();
    if (!lower) {
      return otherJobs;
    }
    return otherJobs.filter((group) => group.job.toLowerCase().includes(lower));
  }, [otherJobs, jobQuery]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-bold">
            {periodLabel} EXP 増加量 — 職業別
          </h3>
          <p className="text-sm text-slate-400">
            冒険家・英雄・シグナス別に表示（各職業 TOP {TOP_PER_JOB}）
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-2.5 text-slate-500" size={18} />
          <Input
            value={jobQuery}
            onChange={(event) => setJobQuery(event.target.value)}
            placeholder="職業名で絞り込み"
            className="pl-10 bg-slate-950 border-slate-800 text-slate-100"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {JOB_ALLIANCES.map((name) => {
          const entry = alliances.find((item) => item.alliance === name);
          const count =
            entry?.branches.reduce(
              (sum, b) => sum + b.jobs.filter((job) => job.memberCount > 0).length,
              0
            ) ?? 0;
          return (
            <Button
              key={name}
              variant={alliance === name ? "default" : "outline"}
              onClick={() => {
                setAlliance(name);
                onExpandJob(null);
                if (name === "冒険家") {
                  const adventurer = JOB_TAXONOMY.find((item) => item.alliance === "冒険家");
                  setBranch(adventurer?.branches[0]?.branch ?? "戦士");
                }
              }}
            >
              {name}
              {count > 0 ? ` (${count})` : ""}
            </Button>
          );
        })}
      </div>

      {isAdventurer && branchNames.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {branchNames.map((name) => {
            const branchEntry = allianceEntry?.branches.find((entry) => entry.branch === name);
            const count =
              branchEntry?.jobs.filter((job) => job.memberCount > 0).length ?? 0;
            return (
              <Button
                key={name}
                variant={branch === name ? "default" : "outline"}
                className={branch === name ? "" : "border-slate-700"}
                onClick={() => {
                  setBranch(name);
                  onExpandJob(null);
                }}
              >
                {name}
                {count > 0 ? ` (${count})` : ""}
              </Button>
            );
          })}
        </div>
      ) : null}

      {expandedGroup ? (
        <div className="rounded-2xl border border-cyan-500/40 bg-slate-950 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-bold text-lg">
              {expandedGroup.job}
              <span className="text-slate-400 text-sm font-normal ml-2">
                {expandedGroup.memberCount} 人
              </span>
            </h4>
            <Button variant="outline" className="border-slate-700" onClick={() => onExpandJob(null)}>
              職業一覧に戻る
            </Button>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <table className="w-full text-base">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th className="text-left p-3 w-12" />
                  <th className="text-left p-3">職業内順位</th>
                  <th className="text-left p-3">キャラ</th>
                  <th className="text-right p-3">Lv / EXP%</th>
                  <th className="text-right p-3">{periodLabel}増加</th>
                  <th className="text-right p-3">レベル順位</th>
                </tr>
              </thead>
              <tbody>
                {expandedGroup.allSorted.map((character) => (
                  <tr
                    key={character.id}
                    onClick={() => onSelect(character.id)}
                    className={`cursor-pointer border-t border-slate-800 hover:bg-slate-800/70 ${
                      selectedId === character.id ? "bg-slate-800" : ""
                    }`}
                  >
                    <td className="p-3 text-center">
                      <FavoriteStar
                        active={isFavorite?.(character)}
                        onToggle={() => onToggleFavorite?.(character)}
                      />
                    </td>
                    <td className={`p-3 font-bold ${gainRankClass(character.jobGainRank)}`}>
                      #{character.jobGainRank}
                    </td>
                    <td className="p-3 font-semibold">{character.name}</td>
                    <td className="p-3 text-right">{formatLevelExp(character)}</td>
                    <td className="p-3 text-right text-emerald-400 font-semibold">
                      +{formatExp(getGainAmount(character, period))}
                    </td>
                    <td className="p-3 text-right text-slate-400">#{character.rank}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredJobs.map((group) => (
              <div
                key={group.job}
                className="rounded-2xl border border-slate-800 bg-slate-950 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-bold">{group.job}</h4>
                    <p className="text-sm text-slate-500">{group.memberCount} 人</p>
                  </div>
                  {group.memberCount > TOP_PER_JOB ? (
                    <Button
                      variant="outline"
                      className="border-slate-700 text-sm shrink-0 py-1"
                      onClick={() => onExpandJob(group.job)}
                    >
                      全員
                    </Button>
                  ) : null}
                </div>
              {group.memberCount > 0 ? (
                <ul className="space-y-2">
                  {group.top.map((character) => (
                    <li key={character.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(character.id)}
                        className={`w-full text-left rounded-xl border px-3 py-2 transition hover:bg-slate-800/80 ${
                          selectedId === character.id
                            ? "border-cyan-500 bg-slate-800"
                            : "border-slate-800"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <FavoriteStar
                              active={isFavorite?.(character)}
                              onToggle={() => onToggleFavorite?.(character)}
                              size={16}
                            />
                            <span
                              className={`font-bold text-sm shrink-0 ${gainRankClass(character.jobGainRank)}`}
                            >
                              #{character.jobGainRank}
                            </span>
                            <span className="font-semibold truncate">{character.name}</span>
                          </div>
                          <span className="text-emerald-400 text-sm font-semibold shrink-0">
                            +{formatExp(getGainAmount(character, period))}
                          </span>
                        </div>
                        <div className="text-sm text-slate-500 mt-1 pl-7">
                          {formatLevelExp(character)} · レベル順位 #{character.rank}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-600 py-2">ランキング対象のキャラがいません</p>
              )}
              </div>
            ))}
          </div>

          {filteredJobs.length === 0 && jobQuery.trim() ? (
            <p className="text-sm text-slate-500 text-center py-8">
              検索に一致する職業がありません。
            </p>
          ) : null}

          {filteredOtherJobs.length > 0 ? (
            <div className="space-y-3 pt-2 border-t border-slate-800">
              <h4 className="font-semibold text-slate-300">その他の職業</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredOtherJobs.map((group) => (
                  <div
                    key={group.job}
                    className="rounded-2xl border border-slate-800 bg-slate-950 p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-bold">{group.job}</h4>
                        <p className="text-sm text-slate-500">{group.memberCount} 人</p>
                      </div>
                      {group.memberCount > TOP_PER_JOB ? (
                        <Button
                          variant="outline"
                          className="border-slate-700 text-sm shrink-0 py-1"
                          onClick={() => onExpandJob(group.job)}
                        >
                          全員
                        </Button>
                      ) : null}
                    </div>
                    <ul className="space-y-2">
                      {group.top.map((character) => (
                        <li key={character.id}>
                          <button
                            type="button"
                            onClick={() => onSelect(character.id)}
                            className={`w-full text-left rounded-xl border px-3 py-2 transition hover:bg-slate-800/80 ${
                              selectedId === character.id
                                ? "border-cyan-500 bg-slate-800"
                                : "border-slate-800"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold truncate">{character.name}</span>
                              <span className="text-emerald-400 text-sm font-semibold shrink-0">
                                +{formatExp(getGainAmount(character, period))}
                              </span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
