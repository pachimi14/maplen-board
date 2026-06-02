import React from "react";
import FavoriteStar from "./FavoriteStar";
import {
  formatExp,
  formatJobName,
  gainRankClass,
  GAIN_PERIOD_LABELS,
  getGainAmount,
  levelExpPercent,
  topGainersForPeriod,
} from "./rankingUtils";

const PERIODS = ["daily", "weekly", "monthly"];

export default function TopGainHighlights({
  characters,
  selectedId,
  onSelect,
  isFavorite,
  onToggleFavorite,
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      {PERIODS.map((period) => {
        const top = topGainersForPeriod(characters, period, 3);
        return (
          <div
            key={period}
            className="bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2"
          >
            <h3 className="font-semibold text-base text-slate-400 mb-1.5">
              {GAIN_PERIOD_LABELS[period]} 増加量 TOP3
            </h3>
            <ul className="space-y-1">
              {top.map((character) => (
                <li key={`${period}-${character.id}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(character.id)}
                    className={`w-full text-left rounded-lg border px-2 py-1.5 transition hover:bg-slate-800/80 ${
                      selectedId === character.id
                        ? "border-cyan-500/70 bg-slate-800/80"
                        : "border-slate-800/80 bg-slate-950/60"
                    }`}
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
                      <p className="col-start-3 row-start-2 col-end-4 min-w-0 text-sm text-slate-500 leading-snug truncate text-left">
                        {(character.level ?? 0) >= 250 ? (
                          <>
                            Lv.{character.level} MAX {formatJobName(character.job)} レベル順位 #
                            {character.rank}
                          </>
                        ) : (
                          <>
                            Lv.{character.level} {levelExpPercent(character).toFixed(3)}%{" "}
                            {formatJobName(character.job)} レベル順位 #{character.rank}
                          </>
                        )}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
