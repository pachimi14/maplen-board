import React, { useMemo, useState } from "react";
import { Plus, Trash2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CharacterSearchPicker from "./CharacterSearchPicker";
import { groupMemberKey } from "./groups";
import { useTranslation } from "./i18n/I18nContext";
import {
  buildGroupGainSeries,
  findCharacterByMemberKey,
  formatExp,
  formatJobName,
} from "./rankingUtils";
import {
  CartesianGrid,
  Legend,
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
  maxMembers,
  onSelectCharacter,
  variant = "full",
}) {
  const { t } = useTranslation();
  const [chartDays, setChartDays] = useState(7);
  const [renameDraft, setRenameDraft] = useState("");

  const memberKeys = activeGroup?.members ?? [];
  const inGroup = isInActiveGroup(character);
  const canAddCurrent =
    !inGroup && memberKeys.length < maxMembers && Boolean(groupMemberKey(character));
  const memberFull = memberKeys.length >= maxMembers && !inGroup;

  const { series, members } = useMemo(
    () => buildGroupGainSeries(characters, memberKeys, chartDays),
    [characters, memberKeys, chartDays],
  );

  const handleAddCharacter = (characterId) => {
    if (!activeGroup || memberKeys.length >= maxMembers) {
      return;
    }
    const target = characters.find((item) => item.id === characterId);
    if (!target) {
      return;
    }
    const added = addMember(activeGroup.id, target);
    if (added && onSelectCharacter) {
      onSelectCharacter(target.id);
    }
  };

  const handleRenameSubmit = (event) => {
    event.preventDefault();
    if (!activeGroup) {
      return;
    }
    renameGroup(activeGroup.id, renameDraft || activeGroup.name);
    setRenameDraft("");
  };

  const chartHeight = variant === "compact" ? "h-52" : "h-72 md:h-80";

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
        <p className="text-sm text-slate-500">{t("group.emptyGroups")}</p>
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
            <p className="text-sm text-amber-300/90">{t("group.memberLimit")}</p>
          ) : null}
        </>
      )}

      {memberKeys.length > 0 ? (
        <div className="space-y-3 pt-2 border-t border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h4 className="font-semibold text-sm">
              {chartDays === 7 ? t("group.chartTitle7d") : t("group.chartTitle30d")}
            </h4>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={chartDays === 7 ? "default" : "outline"}
                className={chartDays === 7 ? "" : "border-slate-700"}
                onClick={() => setChartDays(7)}
              >
                {t("group.days7")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={chartDays === 30 ? "default" : "outline"}
                className={chartDays === 30 ? "" : "border-slate-700"}
                onClick={() => setChartDays(30)}
              >
                {t("group.days30")}
              </Button>
            </div>
          </div>

          <div className={chartHeight}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                  minTickGap={chartDays > 7 ? 4 : 8}
                />
                <YAxis
                  tickFormatter={formatExp}
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                  width={58}
                />
                <Tooltip content={<GroupGainTooltip members={members} t={t} />} />
                <Legend
                  formatter={(value) => {
                    const member = members.find((item) => item.key === value);
                    return member?.name ?? value;
                  }}
                />
                {members.map((member) => (
                  <Line
                    key={member.key}
                    type="monotone"
                    dataKey={member.key}
                    name={member.key}
                    stroke={member.color}
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: member.color, strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
