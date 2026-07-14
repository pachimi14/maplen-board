import { useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import GoalModal from "./GoalModal";
import MyCharacterPinButton from "./MyCharacterPinButton";
import {
  buildGoalDisplayModel,
  classifyHistoryAvailability,
  limitWithOthers,
  pickBestRankStreak,
  rankMovementDirection,
} from "./myCharacterUtils";
import {
  calculateTopPercent,
  computeDailyGainSelfRank,
  computePassedAndOvertaken,
  computePositiveGainStreak,
} from "../stats";
import { LEVEL_CAP, formatExp, formatJobName, getGainAmount, levelExpPercent } from "../rankingUtils";
import { navigateToCharacter } from "../board/useHashRoute";
import { useProfile } from "../profile/ProfileContext";

// §22.11 A⑤: daily-rank-streak tiers, strictest to loosest — the single
// fixed "top 500" is replaced by picking whichever of these is most
// prestigious while still qualifying (see pickBestRankStreak).
const RANK_STREAK_TIERS = [5, 10, 50, 100, 500];

const MOVEMENT_DISPLAY_LIMIT = 3;

/** §22.1: shared "yyyy年m月d日"-style formatting for any ISO date shown on
 * this card (data-as-of note, goal target/arrival dates) — one place so the
 * same locale-aware format is never re-derived slightly differently. */
function formatIsoDateLabel(isoDate, t) {
  if (typeof isoDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return null;
  }
  return t("date.yearMonthDay", {
    year: Number(isoDate.slice(0, 4)),
    month: Number(isoDate.slice(5, 7)),
    day: Number(isoDate.slice(8, 10)),
  });
}

/** §22.11 A①: `valueClassName` lets callers color the value (e.g. the
 * gain amounts, matched to CharacterDetail's `text-emerald-400`) without
 * duplicating this box's layout — label color/size is unaffected. */
function StatBox({ label, children, valueClassName = "text-slate-100" }) {
  return (
    <div className="bg-slate-950 rounded-xl px-3 py-2 min-w-0">
      <div className="text-slate-400 text-xs truncate">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold truncate ${valueClassName}`}>{children}</div>
    </div>
  );
}

/**
 * §22.1: one rank stat per row (label left, value right), replacing the old
 * 3-column `StatBox` grid whose `truncate`/`min-w-0` combination could clip
 * "#10/2381 (top 1.3%)" on narrow screens. `flex-wrap` lets the value wrap
 * onto its own line instead of ever being cut off or shrunk.
 */
function RankRow({ label, rank, total, topPercent, t }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-slate-950 rounded-xl px-3 py-2">
      <span className="text-slate-400 text-xs shrink-0">{label}</span>
      {rank != null ? (
        <span className="text-sm font-semibold text-slate-100 tabular-nums text-right">
          #{rank}
          {total != null ? `/${total}` : ""}
          {topPercent != null ? (
            <span className="text-slate-400 font-normal ml-1.5">
              {t("myCharacters.stat.topPercent", { p: topPercent.toFixed(1) })}
            </span>
          ) : null}
        </span>
      ) : (
        <span className="text-sm text-slate-500">-</span>
      )}
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
 * §22.1/§22.2: the history-dependent stats (streak/self-best), driven
 * purely by the shard fetch state — never triggers a fetch itself (that
 * stays in MyCharacterSummary, the only place that calls `ensureHistories`).
 * Always rendered (no "show more" gate); only the *content* depends on
 * whether the shard has arrived yet. `availability` is computed once by the
 * parent (`classifyHistoryAvailability`) and shared with GoalSection's ②③
 * so the same shard status is never classified twice.
 */
function HistoryDependentStatsSection({ character, availability, onRetryHistory, t }) {
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
  // §22.11 A⑤: strictest-qualifying tier instead of a fixed maxRank; null
  // means no tier reached a 2+ day current streak, so the line falls back
  // to "no streak" wording just like the old current===0 case did.
  const rankStreak = pickBestRankStreak(history, RANK_STREAK_TIERS);
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
          {rankStreak
            ? t("myCharacters.showMoreSection.rankStreak", { count: rankStreak.days, max: rankStreak.maxRank })
            : t("myCharacters.showMoreSection.noStreak")}
        </p>
      </div>
      <div className="min-w-0">
        <div className="text-xs text-slate-400 mb-1">{t("myCharacters.showMoreSection.selfBestTitle")}</div>
        {/* §22.11 A④: value only, no "(of N comparable days)" suffix — kept
            to one line (no wrap) since it's now a single short phrase. */}
        {selfBest.rank != null ? (
          <p className="text-sm text-slate-200 whitespace-nowrap">
            {t("myCharacters.showMoreSection.selfBestValue", { rank: selfBest.rank })}
          </p>
        ) : (
          <p className="text-sm text-slate-500">{t("myCharacters.showMoreSection.selfBestNone")}</p>
        )}
      </div>
    </div>
  );
}

/**
 * §22.3: goal status in 3 always-visible sections (① target ② today's
 * progress ③ arrival estimate). All math is `buildGoalDisplayModel`'s
 * (T3 E `computeGoalProgress`, called once) — this component only lays the
 * returned fields out; it must never recompute achievement rate/arrival
 * date/days-delta itself. Pace is always today's gain (`getGainAmount(...,
 * "daily")`), per §22.3 (never a multi-day average). ②③ need the
 * character's history shard (for `computeGoalProgress`'s today-date
 * resolution) so they're gated by `historyAvailability`, same as the
 * streak/self-best section — ① (target level/date + edit) has no such
 * dependency and is always shown regardless.
 *
 * §22.11 A⑥: ① has no delete button — deleting is already available inside
 * `GoalModal` (opened via "edit"), so a second delete control here would be
 * redundant.
 */
function GoalSection({ character, expTable, historyAvailability, goal, onOpenModal, triggerRef, t }) {
  const todayGain = getGainAmount(character, "daily");
  const progressReady = historyAvailability === "ready";
  const model = progressReady && goal
    ? buildGoalDisplayModel({ character, expTable, goal, todayGain })
    : null;

  return (
    <div className="border-t border-slate-800 pt-3 space-y-3">
      {/* ① target: always visible, independent of the history shard. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-slate-400 mb-0.5">{t("myCharacters.goal.title")}</div>
          {goal ? (
            <p className="text-sm text-slate-200">
              {t("myCharacters.goal.summary", {
                level: goal.targetLevel,
                date: formatIsoDateLabel(goal.targetDateIso, t) ?? goal.targetDateIso,
              })}
            </p>
          ) : (
            <p className="text-sm text-slate-500">{t("myCharacters.goal.none")}</p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            size="sm"
            className="h-7 border-slate-700 bg-slate-950 text-xs"
            onClick={onOpenModal}
          >
            {goal ? t("myCharacters.goal.edit") : t("myCharacters.goal.set")}
          </Button>
        </div>
      </div>

      {goal ? (
        <>
          {/* ② today's progress. */}
          <div>
            <div className="text-xs text-slate-400 mb-1">{t("myCharacters.goal.todayProgressTitle")}</div>
            {!progressReady ? (
              <HistoryGateMessage availability={historyAvailability} t={t} />
            ) : (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="text-slate-200">
                  {t("myCharacters.goal.todayGain", { amount: formatExp(model.todayGain) })}
                </span>
                <span className="text-slate-400">
                  {t("myCharacters.goal.requiredGain", {
                    amount: model.requiredDailyGain != null ? formatExp(model.requiredDailyGain) : "-",
                  })}
                </span>
                <span
                  className={
                    model.achievementRate == null
                      ? "text-slate-500"
                      : model.achievementRate >= 1
                        ? "text-emerald-400 font-semibold"
                        : "text-amber-400 font-semibold"
                  }
                >
                  {t("myCharacters.goal.achievementRate", {
                    percent: model.achievementRate != null ? Math.round(model.achievementRate * 100) : "-",
                  })}
                </span>
              </div>
            )}
          </div>

          {/* ③ arrival estimate. */}
          <div>
            <div className="text-xs text-slate-400 mb-1">{t("myCharacters.goal.arrivalTitle")}</div>
            {!progressReady ? (
              <HistoryGateMessage availability={historyAvailability} t={t} />
            ) : model.achieved ? (
              <p className="text-sm text-emerald-400">{t("myCharacters.goal.achieved")}</p>
            ) : model.indeterminate ? (
              <p className="text-sm text-slate-500">{t("myCharacters.goal.insufficientData")}</p>
            ) : (
              <div className="text-sm space-y-0.5">
                <p className="text-xs text-slate-500">{t("myCharacters.goal.arrivalPremise")}</p>
                <p className="text-slate-200">
                  {t("myCharacters.goal.estimatedArrival", {
                    date: formatIsoDateLabel(model.estimatedArrivalDate, t) ?? model.estimatedArrivalDate,
                  })}
                </p>
                <p
                  className={
                    model.daysDelta > 0
                      ? "text-emerald-400"
                      : model.daysDelta < 0
                        ? "text-rose-400"
                        : "text-slate-400"
                  }
                >
                  {model.daysDelta > 0
                    ? t("myCharacters.goal.ahead", { days: model.daysDelta })
                    : model.daysDelta < 0
                      ? t("myCharacters.goal.behind", { days: Math.abs(model.daysDelta) })
                      : t("myCharacters.goal.onTrack")}
                </p>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Shared "loading/failed/insufficient" wording for ②③'s history-gated
 * content (§22.3), matching HistoryDependentStatsSection's messages so the
 * same shard status never reads differently in two places on the card. */
function HistoryGateMessage({ availability, t }) {
  if (availability === "failed") {
    return <p className="text-sm text-rose-400">{t("myCharacters.state.loadFailed")}</p>;
  }
  if (availability === "insufficient") {
    return <p className="text-sm text-slate-500">{t("myCharacters.state.insufficientHistory")}</p>;
  }
  return <p className="text-sm text-slate-400">{t("myCharacters.state.loading")}</p>;
}

/**
 * The single-character summary card (T4b §5/§20-8/§22.1). Shows the
 * currently displayed pinned character's day-over-day summary immediately
 * (no shard fetch needed); history-dependent stats (streak/self-best/goal
 * progress) show a loading/failed/insufficient state until their shard
 * arrives (fetched by MyCharacterSummary as soon as this character is
 * displayed, §22.2) — there is no "show more" toggle anymore, everything is
 * always visible (§22.1).
 */
export default function MyCharacterCard({
  character,
  historyKey,
  allCharacters,
  meta,
  expTable,
  historyStatus = "idle",
  onRetryHistory,
  t,
}) {
  const { getGoal, primaryHistoryKey } = useProfile();
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const goalTriggerRef = useRef(null);
  const goal = getGoal(historyKey);
  const isPrimary = Boolean(historyKey) && primaryHistoryKey === historyKey;
  // Computed once and shared by HistoryDependentStatsSection and
  // GoalSection's ②③ (§22.3) so the same shard-fetch state is never
  // classified twice.
  const historyAvailability = classifyHistoryAvailability(character?.history, historyStatus);

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

  const handleNavigateToDetail = () => {
    if (historyKey) {
      navigateToCharacter(historyKey);
    }
  };

  return (
    <div className="relative bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-5 sm:p-6 space-y-4">
      {/* §22.11 A③: no title/data-as-of note at all anymore — the card
          leads straight into the header. */}
      {!character ? (
        <p className="text-sm text-amber-300/90 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3">
          {t("myCharacters.notInRanking")}
        </p>
      ) : (
        <>
          {/* §22.1: header reproduced to match CharacterDetail's compact
              header (image/name/job·server/Lv+EXP%/rank colors+sizes) —
              CharacterDetail.jsx itself is never modified (decision A); this
              JSX is an independent re-implementation using the same shared
              formatters (formatJobName/levelExpPercent/formatExp/
              getGainAmount). */}
          <div className="flex items-start gap-4">
            <img
              src={character.imageUrl}
              alt=""
              className="rounded-2xl bg-slate-800 object-cover shrink-0 w-20 h-20 md:w-24 md:h-24"
            />
            <div className="min-w-0 flex-1">
              {/* §22.11 A②: "詳細を見る" moved here (top-right of the
                  header, next to the Main/Sub badge) so it's reachable
                  without scrolling past the whole card; the bottom-of-card
                  button that used to hold this is gone. */}
              <div className="flex items-start justify-between gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    isPrimary ? "bg-cyan-500/20 text-cyan-200" : "bg-slate-700/50 text-slate-300"
                  }`}
                >
                  {t(isPrimary ? "myCharacters.pin.primaryBadge" : "myCharacters.pin.subBadge")}
                </span>
                {/* §22.12 #1: bordered/padded button instead of a plain
                    text link, so it reads as a clear call-to-action next
                    to the small badge — same position/navigation. */}
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-sky-500/50 bg-sky-500/10 px-2.5 py-1 text-sm font-medium text-sky-300 hover:bg-sky-500/20"
                  onClick={handleNavigateToDetail}
                >
                  {t("myCharacters.viewDetail")}
                  <ArrowRight size={14} />
                </button>
              </div>
              <h2 className="text-xl font-bold break-words leading-tight mt-1">
                <button
                  type="button"
                  className="text-inherit hover:text-sky-300 text-left"
                  onClick={handleNavigateToDetail}
                >
                  {character.name}
                </button>
              </h2>

              <div className="flex items-baseline justify-between gap-3 mt-1.5">
                <p className="text-slate-400 min-w-0 text-sm">
                  {formatJobName(character.job)}
                  {character.worldId ? (
                    <>
                      <span className="text-slate-600"> · </span>
                      <span className="text-sky-400 font-medium">{character.worldId}</span>
                    </>
                  ) : null}
                </p>
                <p className="shrink-0 text-right tabular-nums font-bold text-lg whitespace-nowrap">
                  Lv.{character.level ?? 0}
                  {(character.level ?? 0) >= LEVEL_CAP ? (
                    <span className="text-slate-300 ml-3">MAX</span>
                  ) : (
                    <span className="ml-3">{levelExpPercent(character).toFixed(3)}%</span>
                  )}
                </p>
              </div>

              <div className="flex items-baseline justify-between gap-3 mt-1">
                <p className="text-sm text-slate-500 shrink-0">{t("myCharacters.stat.levelRank")}</p>
                <p className="text-sm font-semibold text-cyan-300 tabular-nums text-right">
                  #{character.rank}
                  {overallTopPercent != null ? (
                    <span className="text-slate-400 font-normal ml-1.5">
                      {t("myCharacters.stat.topPercent", { p: overallTopPercent.toFixed(1) })}
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="flex justify-end mt-0.5 text-sm">
                <RankChangeBadge
                  previousRank={character.previousRank}
                  rankFluctuation={character.rankFluctuation}
                  t={t}
                />
              </div>
            </div>
          </div>

          {/* §22.11 A①: gain amounts in the same emerald as CharacterDetail's
              gain figures (labels stay their existing slate color). */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
            <StatBox label={t("myCharacters.stat.dailyGain")} valueClassName="text-emerald-400">
              +{formatExp(getGainAmount(character, "daily"))}
            </StatBox>
            <StatBox label={t("myCharacters.stat.weeklyGain")} valueClassName="text-emerald-400">
              +{formatExp(getGainAmount(character, "weekly"))}
            </StatBox>
            <StatBox label={t("myCharacters.stat.monthlyGain")} valueClassName="text-emerald-400">
              +{formatExp(getGainAmount(character, "monthly"))}
            </StatBox>
          </div>

          {/* §22.1: job/world rank shown in full — no truncation, no
              shrinking font, no ellipsis (the old 3-column StatBox grid
              could clip "#10/2381 (top 1.3%)" on narrow screens). */}
          <div className="space-y-2">
            <RankRow
              label={t("myCharacters.stat.jobRank")}
              rank={character.jobRank}
              total={character.jobRankTotal}
              topPercent={jobTopPercent}
              t={t}
            />
            <RankRow
              label={t("myCharacters.stat.worldRank")}
              rank={character.worldRank}
              total={character.worldRankTotal}
              topPercent={worldTopPercent}
              t={t}
            />
          </div>

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

          <div className="border-t border-slate-800 pt-3">
            <HistoryDependentStatsSection
              character={character}
              availability={historyAvailability}
              onRetryHistory={onRetryHistory}
              t={t}
            />
          </div>

          <GoalSection
            character={character}
            expTable={expTable}
            historyAvailability={historyAvailability}
            goal={goal}
            onOpenModal={() => setGoalModalOpen(true)}
            triggerRef={goalTriggerRef}
            t={t}
          />
        </>
      )}

      {/* Pin controls stay available even when the character has fallen out
          of the exported ranking pool (`character` undefined above): unpin/
          set-primary only need `historyKey` (§20-8 keeps this card the one
          place, besides CharacterDetail, where that's possible). */}
      <MyCharacterPinButton character={character ?? { historyKey }} />

      {character ? (
        <GoalModal
          open={goalModalOpen}
          historyKey={historyKey}
          character={character}
          onClose={() => setGoalModalOpen(false)}
          triggerRef={goalTriggerRef}
          t={t}
        />
      ) : null}
    </div>
  );
}
