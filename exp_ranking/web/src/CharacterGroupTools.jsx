import React, { useEffect, useMemo, useState } from "react";
import { Plus, Star, Trash2, Users, X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CharacterSearchPicker from "./CharacterSearchPicker";
import {
  groupMemberKey,
  groupChartHeightPx,
  loadChartHeightLevel,
  loadChartPeriodState,
  loadFavoritesPanelOpen,
  saveChartHeightLevel,
  saveChartPeriodState,
  saveFavoritesPanelOpen,
} from "./groups";
import { useTranslation } from "./i18n/I18nContext";
import {
  buildGroupGainSeries,
  defaultGroupChartCustomRange,
  findCharacterByMemberKey,
  formatExp,
  formatJobName,
} from "./rankingUtils";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function GroupGainTooltip({ active, payload, label, members, t }) {
  if (!active || !payload?.length) {
    return null;
  }
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/95 px-3 py-2 text-sm shadow-xl">
      <div className="text-slate-400 mb-2">{label}</div>
      <ul className="space-y-1">
        {payload
          .filter((entry) => entry.value != null)
          .map((entry) => {
            const member = members.find((item) => item.key === entry.dataKey);
            return (
              <li key={entry.dataKey} className="flex items-center justify-between gap-4">
                <span className="font-medium" style={{ color: entry.color }}>
                  {member?.name ?? entry.dataKey}
                </span>
                <span className="text-slate-200 tabular-nums">+{formatExp(entry.value)}</span>
              </li>
            );
          })}
      </ul>
      {payload.every((entry) => entry.value == null) ? (
        <div className="text-slate-500">{t("group.noDataPoint")}</div>
      ) : null}
    </div>
  );
}

function GroupChartLegend({ members, highlightedKey, onHighlight }) {
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-2 pt-3 text-xs text-slate-300">
      {members.map((member) => {
        const active = highlightedKey === member.key;
        return (
          <li key={member.key}>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-slate-800/70"
              onMouseEnter={() => onHighlight(member.key)}
              onMouseLeave={() => onHighlight(null)}
              onFocus={() => onHighlight(member.key)}
              onBlur={() => onHighlight(null)}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: member.color }}
              />
              <span className={active ? "font-semibold" : ""}>{member.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function GroupToggleButton({
  active,
  onToggle,
  disabled = false,
  size = 22,
  className = "",
}) {
  const { t } = useTranslation();
  const label = active ? t("group.removeFromGroup") : t("group.addToGroup");

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={`inline-flex items-center justify-center rounded-lg p-1 transition hover:bg-slate-800/80 disabled:opacity-40 disabled:pointer-events-none ${className}`}
    >
      <Users
        size={size}
        className={active ? "text-sky-400" : "text-slate-500 hover:text-sky-300"}
      />
    </button>
  );
}

function FavoriteAddSection({
  favorites,
  characters,
  activeGroup,
  memberKeys,
  maxMembers,
  addMember,
  addFavoritesToGroup,
  t,
}) {
  const [open, setOpen] = useState(() => loadFavoritesPanelOpen());
  const slotsLeft = maxMembers - memberKeys.length;
  const favoriteRows = useMemo(() => {
    return [...favorites]
      .map((key) => {
        const character = findCharacterByMemberKey(characters, key);
        return { key, character, inGroup: memberKeys.includes(key) };
      })
      .sort((a, b) => a.key.localeCompare(b.key, "ja"));
  }, [favorites, characters, memberKeys]);

  const pendingRows = favoriteRows.filter((row) => !row.inGroup);
  const pendingCount = Math.min(pendingRows.length, slotsLeft);

  if (favorites.size === 0) {
    return null;
  }

  const handleAddFavorite = (row) => {
    if (row.inGroup || slotsLeft <= 0) {
      return;
    }
    if (activeGroup && row.character) {
      addMember(activeGroup.id, row.character);
      return;
    }
    addFavoritesToGroup([row.key]);
  };

  const toggleOpen = () => {
    setOpen((previous) => {
      const next = !previous;
      saveFavoritesPanelOpen(next);
      return next;
    });
  };

  const handleAddAll = () => {
    if (pendingCount <= 0) {
      return;
    }
    addFavoritesToGroup(pendingRows.map((row) => row.key));
  };

  return (
    <div className="space-y-2 pt-2 border-t border-slate-800">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
          aria-expanded={open}
          aria-label={open ? t("group.hideFavoritesPanel") : t("group.showFavoritesPanel")}
          onClick={toggleOpen}
        >
          <Star size={14} className="text-amber-400/90 shrink-0" />
          {t("group.addFromFavorites")}
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {open && pendingCount > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-amber-700/60 text-amber-200 hover:bg-amber-950/40 shrink-0"
            onClick={handleAddAll}
          >
            {t("group.addAllFavorites", { count: pendingCount })}
          </Button>
        ) : null}
      </div>

      {open ? (
        <>
          <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
        {favoriteRows.map((row) => {
          const disabled = row.inGroup || slotsLeft <= 0;
          return (
            <button
              key={row.key}
              type="button"
              disabled={row.inGroup || slotsLeft <= 0}
              onClick={() => handleAddFavorite(row)}
              className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                row.inGroup
                  ? "border-sky-500/60 bg-sky-950/40 text-sky-100 cursor-default"
                  : disabled
                    ? "border-slate-800 bg-slate-900/60 text-slate-500 cursor-not-allowed"
                    : "border-amber-700/50 bg-amber-950/20 text-amber-100 hover:bg-amber-950/40"
              }`}
            >
              <Star
                size={12}
                className={row.inGroup ? "text-sky-400" : "text-amber-400/90 shrink-0"}
              />
              <span className="font-medium">{row.key}</span>
              {row.character ? (
                <span className="text-slate-500 text-xs hidden sm:inline">
                  {formatJobName(row.character.job)}
                </span>
              ) : (
                <span className="text-amber-400/80 text-xs">{t("group.notFound")}</span>
              )}
            </button>
          );
        })}
      </div>

          {pendingRows.length === 0 ? (
            <p className="text-sm text-slate-500">{t("group.allFavoritesInGroup")}</p>
          ) : null}
          {pendingRows.length > 0 && slotsLeft <= 0 ? (
            <p className="text-sm text-amber-300/90">{t("group.memberLimit", { max: maxMembers })}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default function CharacterGroupTools({
  character,
  characters,
  groups,
  activeGroup,
  activeGroupId,
  setActiveGroupId,
  createGroup,
  deleteGroup,
  renameGroup,
  addMember,
  removeMember,
  isInActiveGroup,
  toggleMemberInActiveGroup,
  addFavoritesToGroup,
  favorites,
  maxMembers,
  onSelectCharacter,
  variant = "full",
}) {
  const { t } = useTranslation();
  const [chartPeriod, setChartPeriod] = useState(() => loadChartPeriodState());
  const [chartHeightLevel, setChartHeightLevel] = useState(() => loadChartHeightLevel());
  const [renameDraft, setRenameDraft] = useState("");
  const [highlightedMemberKey, setHighlightedMemberKey] = useState(null);

  const memberKeys = activeGroup?.members ?? [];
  const inGroup = isInActiveGroup(character);
  const memberFull = memberKeys.length >= maxMembers && !inGroup;

  const chartRange = useMemo(() => {
    if (chartPeriod.mode === "custom") {
      const defaults = defaultGroupChartCustomRange(characters, memberKeys, 7);
      let start = chartPeriod.start || defaults.start;
      let end = chartPeriod.end || defaults.end;
      if (start && end && start > end) {
        [start, end] = [end, start];
      }
      return { start, end };
    }
    return { days: Number(chartPeriod.mode) || 7 };
  }, [chartPeriod, characters, memberKeys]);

  const { series, members } = useMemo(
    () => buildGroupGainSeries(characters, memberKeys, chartRange),
    [characters, memberKeys, chartRange],
  );

  const chartTitle = useMemo(() => {
    if (chartPeriod.mode === "7") {
      return t("group.chartTitle7d");
    }
    if (chartPeriod.mode === "30") {
      return t("group.chartTitle30d");
    }
    if (chartRange.start && chartRange.end) {
      return t("group.chartTitleCustom", { from: chartRange.start, to: chartRange.end });
    }
    return t("group.chartTitleCustomRange");
  }, [chartPeriod.mode, chartRange, t]);

  useEffect(() => {
    setHighlightedMemberKey(null);
  }, [chartPeriod.mode, chartPeriod.start, chartPeriod.end, memberKeys.join("|")]);

  const setPeriodMode = (mode) => {
    if (mode === "custom") {
      const defaults = defaultGroupChartCustomRange(characters, memberKeys, 7);
      const next = {
        mode: "custom",
        start: chartPeriod.start || defaults.start,
        end: chartPeriod.end || defaults.end,
      };
      setChartPeriod(next);
      saveChartPeriodState(next);
      return;
    }
    const next = { mode, start: "", end: "" };
    setChartPeriod(next);
    saveChartPeriodState(next);
  };

  const updateCustomRange = (field, value) => {
    const next = {
      mode: "custom",
      start: field === "start" ? value : chartPeriod.start,
      end: field === "end" ? value : chartPeriod.end,
    };
    setChartPeriod(next);
    saveChartPeriodState(next);
  };

  const handleAddCharacter = (characterId) => {
    if (!activeGroup || memberKeys.length >= maxMembers) {
      return;
    }
    const target = characters.find((item) => item.id === characterId);
    if (!target) {
      return;
    }
    addMember(activeGroup.id, target);
  };

  const handleRenameSubmit = (event) => {
    event.preventDefault();
    if (!activeGroup) {
      return;
    }
    renameGroup(activeGroup.id, renameDraft || activeGroup.name);
    setRenameDraft("");
  };

  const chartHeightPx = groupChartHeightPx(variant, chartHeightLevel);

  const setChartHeight = (level) => {
    setChartHeightLevel(level);
    saveChartHeightLevel(level);
  };

  return (
    <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-bold flex items-center gap-2">
            <Users size={18} className="text-sky-400" />
            {t("group.title")}
          </h3>
          <p className="text-sm text-slate-400 mt-1">
            {t("group.subtitle", { max: maxMembers })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button
            type="button"
            size="sm"
            variant={inGroup ? "outline" : "default"}
            className={inGroup ? "border-sky-700 text-sky-200" : ""}
            disabled={memberFull && !inGroup}
            onClick={() => toggleMemberInActiveGroup(character)}
          >
            {inGroup ? t("group.removeFromGroup") : t("group.addToGroup")}
          </Button>
          {variant === "full" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-slate-700 bg-slate-900"
              onClick={createGroup}
            >
              <Plus size={14} className="mr-1" />
              {t("group.newGroup")}
            </Button>
          ) : null}
        </div>
      </div>

      {groups.length === 0 ? (
        <>
          {favorites?.size > 0 ? (
            <FavoriteAddSection
              favorites={favorites}
              characters={characters}
              activeGroup={activeGroup}
              memberKeys={memberKeys}
              maxMembers={maxMembers}
              addMember={addMember}
              addFavoritesToGroup={addFavoritesToGroup}
              t={t}
            />
          ) : null}
          {favorites?.size === 0 ? (
            <p className="text-sm text-slate-500">{t("group.emptyGroups")}</p>
          ) : null}
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {groups.map((group) => (
              <Button
                key={group.id}
                type="button"
                size="sm"
                variant={group.id === activeGroupId ? "default" : "outline"}
                className={group.id === activeGroupId ? "" : "border-slate-700 bg-slate-900"}
                onClick={() => setActiveGroupId(group.id)}
              >
                {group.name}
                {group.members.length > 0 ? ` (${group.members.length})` : ""}
              </Button>
            ))}
          </div>

          {activeGroup && variant === "full" ? (
            <form
              className="flex flex-col sm:flex-row gap-2 sm:items-center"
              onSubmit={handleRenameSubmit}
            >
              <Input
                value={renameDraft || activeGroup.name}
                onChange={(event) => setRenameDraft(event.target.value)}
                onFocus={() => setRenameDraft(activeGroup.name)}
                className="bg-slate-900 border-slate-700 text-slate-100 max-w-xs"
                aria-label={t("group.rename")}
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" variant="outline" className="border-slate-700">
                  {t("group.rename")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-red-900/60 text-red-300 hover:bg-red-950/40"
                  onClick={() => deleteGroup(activeGroup.id)}
                  disabled={groups.length <= 1}
                >
                  <Trash2 size={14} className="mr-1" />
                  {t("group.delete")}
                </Button>
              </div>
            </form>
          ) : null}

          <div>
            <div className="text-sm text-slate-400 mb-2">
              {t("group.members", { count: memberKeys.length, max: maxMembers })}
            </div>
            <div className="flex flex-wrap gap-2">
              {memberKeys.length === 0 ? (
                <p className="text-sm text-slate-500">{t("group.emptyMembers")}</p>
              ) : (
                memberKeys.map((key) => {
                  const memberCharacter = findCharacterByMemberKey(characters, key);
                  const isCurrent = memberCharacter?.id === character.id;
                  return (
                    <div
                      key={key}
                      className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm ${
                        isCurrent
                          ? "border-sky-500/60 bg-sky-950/40 text-sky-100"
                          : "border-slate-700 bg-slate-900 text-slate-200"
                      }`}
                    >
                      <button
                        type="button"
                        className="font-medium hover:underline"
                        onClick={() => memberCharacter && onSelectCharacter?.(memberCharacter.id)}
                      >
                        {key}
                      </button>
                      {memberCharacter ? (
                        <span className="text-slate-500 text-xs hidden sm:inline">
                          {formatJobName(memberCharacter.job)}
                        </span>
                      ) : (
                        <span className="text-amber-400/80 text-xs">{t("group.notFound")}</span>
                      )}
                      <button
                        type="button"
                        className="text-slate-500 hover:text-red-300 ml-1"
                        aria-label={t("group.removeMember")}
                        onClick={() => removeMember(activeGroup.id, key)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {variant === "full" && activeGroup && memberKeys.length < maxMembers ? (
            <div className="max-w-md">
              <div className="text-sm text-slate-400 mb-2">{t("group.addMember")}</div>
              <CharacterSearchPicker
                characters={characters}
                selectedId={character.id}
                onSelect={handleAddCharacter}
              />
            </div>
          ) : null}

          {memberFull && !inGroup ? (
            <p className="text-sm text-amber-300/90">{t("group.memberLimit", { max: maxMembers })}</p>
          ) : null}

          {favorites?.size > 0 ? (
            <FavoriteAddSection
              favorites={favorites}
              characters={characters}
              activeGroup={activeGroup}
              memberKeys={memberKeys}
              maxMembers={maxMembers}
              addMember={addMember}
              addFavoritesToGroup={addFavoritesToGroup}
              t={t}
            />
          ) : null}
        </>
      )}

      {memberKeys.length > 0 ? (
        <div className="space-y-3 pt-2 border-t border-slate-800">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h4 className="font-semibold text-sm">{chartTitle}</h4>
              <div className="flex flex-wrap gap-2 justify-end">
                <div className="flex gap-1">
                  {(["normal", "large", "xlarge"]).map((level) => (
                    <Button
                      key={level}
                      type="button"
                      size="sm"
                      variant={chartHeightLevel === level ? "default" : "outline"}
                      className={chartHeightLevel === level ? "" : "border-slate-700"}
                      onClick={() => setChartHeight(level)}
                    >
                      {t(`group.chartHeight.${level}`)}
                    </Button>
                  ))}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={chartPeriod.mode === "7" ? "default" : "outline"}
                  className={chartPeriod.mode === "7" ? "" : "border-slate-700"}
                  onClick={() => setPeriodMode("7")}
                >
                  {t("group.days7")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={chartPeriod.mode === "30" ? "default" : "outline"}
                  className={chartPeriod.mode === "30" ? "" : "border-slate-700"}
                  onClick={() => setPeriodMode("30")}
                >
                  {t("group.days30")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={chartPeriod.mode === "custom" ? "default" : "outline"}
                  className={chartPeriod.mode === "custom" ? "" : "border-slate-700"}
                  onClick={() => setPeriodMode("custom")}
                >
                  {t("group.chartPeriodCustom")}
                </Button>
              </div>
            </div>

            {chartPeriod.mode === "custom" ? (
              <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                <div className="flex-1 min-w-0">
                  <label className="block text-xs text-slate-400 mb-1">{t("group.chartDateFrom")}</label>
                  <Input
                    type="date"
                    value={chartRange.start || ""}
                    onChange={(event) => updateCustomRange("start", event.target.value)}
                    className="bg-slate-900 border-slate-700 text-slate-100"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <label className="block text-xs text-slate-400 mb-1">{t("group.chartDateTo")}</label>
                  <Input
                    type="date"
                    value={chartRange.end || ""}
                    onChange={(event) => updateCustomRange("end", event.target.value)}
                    className="bg-slate-900 border-slate-700 text-slate-100"
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div style={{ height: chartHeightPx }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series}
                margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
                isAnimationActive={false}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                  minTickGap={series.length > 14 ? 4 : 8}
                />
                <YAxis
                  tickFormatter={formatExp}
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                  width={58}
                />
                <Tooltip content={<GroupGainTooltip members={members} t={t} />} />
                {members.map((member) => {
                  const isHighlighted = highlightedMemberKey === member.key;
                  const isOther = Boolean(highlightedMemberKey && !isHighlighted);
                  return (
                    <Line
                      key={member.key}
                      type="monotone"
                      dataKey={member.key}
                      name={member.key}
                      stroke={member.color}
                      strokeWidth={isHighlighted ? 6 : isOther ? 1.5 : 2.5}
                      dot={{ r: isHighlighted ? 4 : 3, fill: member.color, strokeWidth: 0 }}
                      activeDot={{ r: isHighlighted ? 7 : 5 }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <GroupChartLegend
            members={members}
            highlightedKey={highlightedMemberKey}
            onHighlight={setHighlightedMemberKey}
          />
        </div>
      ) : null}
    </div>
  );
}
