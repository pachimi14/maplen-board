import { useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import GoalModal from "./GoalModal";
import MyCharacterPinButton from "./MyCharacterPinButton";
import {
  classifyHistoryAvailability,
  isLatestDateToday,
  limitWithOthers,
  rankMovementDirection,
} from "./myCharacterUtils";
import {
  calculateAverageDailyGain,
  calculateTopPercent,
  computeDailyGainSelfRank,
  computeDailyRankStreak,
  computeGoalProgress,
  computePassedAndOvertaken,
  computePositiveGainStreak,
} from "../stats";
import { formatExp, formatJobName, getGainAmount } from "../rankingUtils";
import { useProfile } from "../profile/ProfileContext";

// Trailing window for the goal-progress pace source (T3 F), independent of
// the 7d/30d averages shown elsewhere — a single explicit choice per T3 F's
// contract that the pace source is always caller-chosen.
const GOAL_PACE_WINDOW_DAYS = 7;

// Initial daily-rank streak window (T3 C2 `maxRank`, per IMPL_PLAN_T4B §5).
const RANK_STREAK_MAX = 500;

const MOVEMENT_DISPLAY_LIMIT = 3;

function StatBox({ label, children }) {
  return (
    <div className="bg-slate-950 rounded-xl px-3 py-2 min-w-0">
      <div className="text-slate-400 text-xs truncate">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-slate-100 truncate">{children}</div>
    </div>
  );
}

function RankChangeBadge({ previousRank, rankFluctuation, t }) {
  const direction = rankMovementDirection(previousRank, rankFluctuation);
  if (direction === "unknown") {
    return <span className="text-slate-500">{t("myCharacters.stat.newOrIncomparable")}</span>;
  }
  if (direction === "up") {
    return (
      <span className="text-emerald-400">{t("myCharacters.stat.rankUp", { count: Math.abs(rankFluctuation) })}</span>
    );
  }
  if (direction === "down") {
    return (
      <span className="text-rose-400">{t("myCharacters.stat.rankDown", { count: Math.abs(rankFluctuation) })}</span>
    );
  }
  return <span className="text-slate-400">{t("myCharacters.stat.rankSame")}</span>;
}

function MovementList({ title, entries, othersCount, t }) {
  if (!entries.length) {
    return null;
  }
  return (
    <div className="min-w-0">
      <div className="text-xs text-slate-400 mb-1">{title}</div>
      <ul className="space-y-0.5">
        {entries.map((entry) => (
          <li key={entry.historyKey} className="text-sm text-slate-200 truncate">
            {entry.name || entry.historyKey}
            <span className="text-slate-500 ml-1.5">#{entry.rank}</span>
          </li>
        ))}
      </ul>
      {othersCount > 0 ? (
        <div className="text-xs text-slate-500 mt-0.5">{t("myCharacters.movement.others", { n: othersCount })}</div>
      ) : null}
    </div>
  );
}

/**
 * §6/§20-4: the "show more" region's content, driven purely by the shard
 * fetch state — never triggers a fetch itself (that stays in
 * MyCharacterSummary, the only place that calls `ensureHistories`).
 */
function ExpandedHistorySection({ character, historyStatus, onRetryHistory, t }) {
  const availability = classifyHistoryAvailability(character?.history, historyStatus);

  if (availability === "idle" || availability === "loading") {
    return <p className="text-sm text-slate-400">{t("myCharacters.state.loading")}</p>;
  }

  if (availability === "failed") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-rose-400">{t("myCharacters.state.loadFailed")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 border-slate-700 bg-slate-950 text-xs"
          onClick={onRetryHistory}
        >
          {t("myCharacters.state.retry")}
        </Button>
      </div>
    );
  }

  if (availability === "insufficient") {
    return <p className="text-sm text-slate-500">{t("myCharacters.state.insufficientHistory")}</p>;
  }

  const history = character.history;
  const positiveStreak = computePositiveGainStreak(history);
  const rankStreak = computeDailyRankStreak(history, { maxRank: RANK_STREAK_MAX });
  const selfBest = computeDailyGainSelfRank(history);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="min-w-0">
        <div className="text-xs text-slate-400 mb-1">{t("myCharacters.showMoreSection.streakTitle")}</div>
        <p className="text-sm text-slate-200">
          {positiveStreak.current > 0
            ? t("myCharacters.showMoreSection.positive", { count: positiveStreak.current })
            : t("myCharacters.showMoreSection.noStreak")}
        </p>
        <p className="text-sm text-slate-200 mt-0.5">
          {rankStreak.current > 0
            ? t("myCharacters.showMoreSection.rankStreak", { count: rankStreak.current, max: RANK_STREAK_MAX })
            : t("myCharacters.showMoreSection.noStreak")}
        </p>
      </div>
      <div className="min-w-0">
        <div className="text-xs text-slate-400 mb-1">{t("myCharacters.showMoreSection.selfBestTitle")}</div>
        {selfBest.rank != null ? (
          <p className="text-sm text-slate-200">
            {t("myCharacters.showMoreSection.selfBestValue", { rank: selfBest.rank })}{" "}
            <span className="text-slate-500">
              {t("myCharacters.showMoreSection.selfBestOf", { total: selfBest.totalComparableDays })}
            </span>
          </p>
        ) : (
          <p className="text-sm text-slate-500">{t("myCharacters.showMoreSection.selfBestNone")}</p>
        )}
      </div>
    </div>
  );
}

/**
 * §9: goal status + progress display, plus the trigger that opens
 * `GoalModal`. Reuses T3 E (`computeGoalProgress`) + T3 F
 * (`calculateAverageDailyGain`) for the estimate; never re-implements the
 * pace/validity logic itself. `triggerRef` lets the modal return focus here
 * on close.
 */
function GoalSection({ character, expTable, goal, onOpenModal, triggerRef, t }) {
  const history = Array.isArray(character.history) ? character.history : [];
  const averageDailyGain = history.length
    ? calculateAverageDailyGain(history, { days: GOAL_PACE_WINDOW_DAYS })
    : null;
  const progress = goal ? computeGoalProgress(character, expTable, goal, { averageDailyGain }) : null;

  const progressLabel = (() => {
    if (!progress) {
      return null;
    }
    switch (progress.status) {
      case "achieved":
        return t("myCharacters.goal.achieved");
      case "ahead":
        return t("myCharacters.goal.ahead", { days: Math.abs(progress.daysDelta) });
      case "behind":
        return t("myCharacters.goal.behind", { days: Math.abs(progress.daysDelta) });
      case "onTrack":
        return t("myCharacters.goal.onTrack");
      default:
        return t("myCharacters.goal.insufficientData");
    }
  })();

  return (
    <div className="border-t border-slate-800 pt-3 flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-xs text-slate-400 mb-0.5">{t("myCharacters.goal.title")}</div>
        {goal ? (
          <p className="text-sm text-slate-200">
            Lv.{goal.targetLevel} · {goal.targetDateIso}
            {progressLabel ? <span className="text-slate-400 ml-2">{progressLabel}</span> : null}
          </p>
        ) : (
          <p className="text-sm text-slate-500">{t("myCharacters.goal.none")}</p>
        )}
      </div>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        className="h-7 border-slate-700 bg-slate-950 text-xs shrink-0"
        onClick={onOpenModal}
      >
        {goal ? t("myCharacters.goal.edit") : t("myCharacters.goal.set")}
      </Button>
    </div>
  );
}

/**
 * The single-character summary card (T4b §5/§20-8). Shows the currently
 * displayed pinned character's day-over-day summary immediately (no shard
 * fetch needed); the "show more" toggle reveals history-dependent stats
 * (wired in a later commit) without ever rendering all pinned characters
 * stacked (§20-8: one card, switch UI elsewhere).
 */
export default function MyCharacterCard({
  character,
  historyKey,
  allCharacters,
  meta,
  expTable,
  expanded,
  onToggleExpanded,
  historyStatus = "idle",
  onRetryHistory,
  t,
}) {
  const { getGoal } = useProfile();
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const goalTriggerRef = useRef(null);
  const goal = getGoal(historyKey);

  const latestSnapshotDate = meta?.latestSnapshotDate ?? null;
  const isToday = isLatestDateToday(latestSnapshotDate);
  const asOfDate = latestSnapshotDate
    ? t("date.yearMonthDay", {
        year: Number(latestSnapshotDate.slice(0, 4)),
        month: Number(latestSnapshotDate.slice(5, 7)),
        day: Number(latestSnapshotDate.slice(8, 10)),
      })
    : null;

  const movement = character
    ? computePassedAndOvertaken(
        { historyKey: character.historyKey, rank: character.rank, previousRank: character.previousRank },
        allCharacters,
      )
    : { passed: [], overtakenBy: [] };
  const passed = limitWithOthers(movement.passed, MOVEMENT_DISPLAY_LIMIT);
  const overtaken = limitWithOthers(movement.overtakenBy, MOVEMENT_DISPLAY_LIMIT);

  const overallTotal = meta?.characterCount ?? allCharacters?.length ?? null;
  const overallTopPercent = character ? calculateTopPercent(character.rank, overallTotal) : null;
  const jobTopPercent = character ? calculateTopPercent(character.jobRank, character.jobRankTotal) : null;
  const worldTopPercent = character ? calculateTopPercent(character.worldRank, character.worldRankTotal) : null;

  return (
    <div className="relative bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">
            {isToday ? t("myCharacters.todaySummary") : t("myCharacters.latestSummary")}
          </h2>
          {asOfDate ? <p className="text-xs text-slate-500 mt-0.5">{t("myCharacters.asOf", { date: asOfDate })}</p> : null}
        </div>
      </div>

      {!character ? (
        <p className="text-sm text-amber-300/90 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3">
          {t("myCharacters.notInRanking")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold truncate">{character.name}</div>
              <div className="text-sm text-slate-400 truncate">
                {formatJobName(character.job)}
                {character.worldId ? ` · ${character.worldId}` : ""}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
            <StatBox label={t("myCharacters.stat.dailyGain")}>+{formatExp(getGainAmount(character, "daily"))}</StatBox>
            <StatBox label={t("myCharacters.stat.weeklyGain")}>+{formatExp(getGainAmount(character, "weekly"))}</StatBox>
            <StatBox label={t("myCharacters.stat.monthlyGain")}>+{formatExp(getGainAmount(character, "monthly"))}</StatBox>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
            <StatBox label={t("myCharacters.stat.levelRank")}>
              <span className="tabular-nums">#{character.rank}</span>{" "}
              <RankChangeBadge previousRank={character.previousRank} rankFluctuation={character.rankFluctuation} t={t} />
            </StatBox>
            <StatBox label={t("myCharacters.stat.jobRank")}>
              {character.jobRank != null ? (
                <>
                  <span className="tabular-nums">
                    #{character.jobRank}/{character.jobRankTotal}
                  </span>
                  {jobTopPercent != null ? (
                    <span className="text-slate-400 ml-1.5">
                      {t("myCharacters.stat.topPercent", { p: jobTopPercent.toFixed(1) })}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-slate-500">-</span>
              )}
            </StatBox>
            <StatBox label={t("myCharacters.stat.worldRank")}>
              {character.worldRank != null ? (
                <>
                  <span className="tabular-nums">
                    #{character.worldRank}/{character.worldRankTotal}
                  </span>
                  {worldTopPercent != null ? (
                    <span className="text-slate-400 ml-1.5">
                      {t("myCharacters.stat.topPercent", { p: worldTopPercent.toFixed(1) })}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-slate-500">-</span>
              )}
            </StatBox>
          </div>
          {overallTopPercent != null ? (
            <p className="text-xs text-slate-500 -mt-2">
              {t("myCharacters.stat.topPercent", { p: overallTopPercent.toFixed(1) })}
            </p>
          ) : null}

          {passed.shown.length || overtaken.shown.length ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <MovementList title={t("myCharacters.movement.passedTitle")} entries={passed.shown} othersCount={passed.othersCount} t={t} />
              <MovementList
                title={t("myCharacters.movement.overtakenTitle")}
                entries={overtaken.shown}
                othersCount={overtaken.othersCount}
                t={t}
              />
              <p className="text-xs text-slate-600 sm:col-span-2">{t("myCharacters.movement.hint")}</p>
            </div>
          ) : null}
        </>
      )}

      {/* Pin controls stay available even when the character has fallen out
          of the exported ranking pool (`character` undefined above): unpin/
          set-primary only need `historyKey` (§20-8 keeps this card the one
          place, besides CharacterDetail, where that's possible). */}
      <MyCharacterPinButton character={character ?? { historyKey }} />

      {character ? (
        <>
          <Button
            type="button"
            variant="outline"
            className="w-full border-slate-700 bg-slate-950 hover:bg-slate-800"
            onClick={onToggleExpanded}
          >
            {expanded ? <ChevronUp size={16} className="mr-2" /> : <ChevronDown size={16} className="mr-2" />}
            {expanded ? t("myCharacters.showLess") : t("myCharacters.showMore")}
          </Button>

          {expanded ? (
            <div className="border-t border-slate-800 pt-4 space-y-3">
              <ExpandedHistorySection
                character={character}
                historyStatus={historyStatus}
                onRetryHistory={onRetryHistory}
                t={t}
              />
              <GoalSection
                character={character}
                expTable={expTable}
                goal={goal}
                onOpenModal={() => setGoalModalOpen(true)}
                triggerRef={goalTriggerRef}
                t={t}
              />
            </div>
          ) : null}

          <GoalModal
            open={goalModalOpen}
            historyKey={historyKey}
            character={character}
            onClose={() => setGoalModalOpen(false)}
            triggerRef={goalTriggerRef}
            t={t}
          />
        </>
      ) : null}
    </div>
  );
}
