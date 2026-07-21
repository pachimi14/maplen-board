import React from "react";
import FavoriteStar from "./FavoriteStar";
import { useTranslation } from "./i18n/I18nContext";
import {
  formatExp,
  formatJobName,
  gainRankClass,
  getGainAmount,
  LEVEL_CAP,
  levelExpPercent,
  topGainersForPeriod,
} from "./rankingUtils";

const PERIODS = ["daily", "weekly", "monthly"];

function PeriodTop3({ period, characters, gainRankMaps, onSelectCharacter, isFavorite, onToggleFavorite }) {
  const { t } = useTranslation();
  const periodLabel = t(`period.${period}Short`);
  const top = topGainersForPeriod(characters, period, 3, gainRankMaps);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2">
      <h3 className="font-semibold text-base text-slate-400 mb-1.5">
        {periodLabel}
      </h3>
      <ul className="space-y-1">
        {top.map((character) => (
          <li key={`${period}-${character.id}`}>
            {/* A non-button clickable row: the FavoriteStar inside it is
                itself a real <button>, and HTML forbids <button> nesting
                (React would otherwise warn/hydration-error on this in the
                list view). role="button" + onKeyDown keeps it operable
                from the keyboard, matching RankingTable's <tr onClick>
                row (also not a <button>) for the same reason. */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelectCharacter(character)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectCharacter(character);
                }
              }}
              className="w-full text-left rounded-lg border border-slate-800/80 bg-slate-950/60 px-2 py-1.5 transition hover:bg-slate-800/80 cursor-pointer"
            >
              <div className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] gap-x-1 gap-y-0.5 items-start min-w-0">
                <div className="col-start-1 row-start-1 w-3.5 shrink-0 flex justify-center">
                  {onToggleFavorite ? (
                    <FavoriteStar
                      active={isFavorite?.(character)}
                      onToggle={() => onToggleFavorite?.(character)}
                      size={14}
                    />
                  ) : null}
                </div>
                <span
                  className={`col-start-2 row-start-1 font-bold text-base shrink-0 leading-snug ${gainRankClass(character.gainRank)}`}
                >
                  #{character.gainRank}
                </span>
                <span className="col-start-3 row-start-1 font-semibold text-base leading-snug break-words min-w-0">
                  {character.name}
                </span>
                <span className="col-start-4 row-start-1 text-emerald-400 text-base font-semibold tabular-nums whitespace-nowrap shrink-0">
                  +{formatExp(getGainAmount(character, period))}
                </span>
                <p className="col-start-3 row-start-2 col-end-5 min-w-0 text-sm text-slate-400 leading-snug text-left">
                  {(character.level ?? 0) >= LEVEL_CAP ? (
                    <>
                      Lv.{character.level} MAX · {t("highlights.levelRank")} #{character.rank}
                    </>
                  ) : (
                    <>
                      Lv.{character.level} {levelExpPercent(character).toFixed(3)}% ·{" "}
                      {t("highlights.levelRank")} #{character.rank}
                    </>
                  )}
                </p>
                <p className="col-start-3 row-start-3 col-end-5 min-w-0 text-xs text-slate-500 leading-snug break-words text-left">
                  {formatJobName(character.job)}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TopGainHighlights({
  characters,
  gainRankMaps,
  onSelectCharacter,
  isFavorite,
  onToggleFavorite,
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      {PERIODS.map((period) => (
        <PeriodTop3
          key={period}
          period={period}
          characters={characters}
          gainRankMaps={gainRankMaps}
          onSelectCharacter={onSelectCharacter}
          isFavorite={isFavorite}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </div>
  );
}
