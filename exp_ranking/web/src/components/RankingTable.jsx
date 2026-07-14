import { Search, Star } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import FavoriteStar from "../FavoriteStar";
import NavigatorLink from "../NavigatorLink";
import {
  formatExp,
  formatJobName,
  formatLevelExp,
  gainRankClass,
  getGainAmount,
  getNavigatorUrl,
} from "../rankingUtils";

export default function RankingTable({
  cardClassName = "",
  title,
  favoritesOnly,
  onToggleFavoritesOnly,
  favoriteCount,
  query,
  onQueryChange,
  setRankingControlsTarget,
  total,
  pagedCharacters,
  showGainRank,
  filteredGainRanks,
  onRowNavigate,
  isFavorite,
  onToggleFavorite,
  sortKey,
  safePage,
  totalPages,
  onPrevPage,
  onNextPage,
  rangeFrom,
  rangeTo,
  t,
  searchInputRef,
}) {
  return (
    <Card className={`bg-slate-900 border border-slate-800 rounded-2xl shadow-xl ${cardClassName}`}>
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <h2 className="text-xl font-bold">{title}</h2>
          <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
            <Button
              type="button"
              variant={favoritesOnly ? "default" : "outline"}
              className={
                favoritesOnly
                  ? "bg-amber-600 hover:bg-amber-500 text-white border-amber-500"
                  : "border-slate-700 bg-slate-950"
              }
              onClick={onToggleFavoritesOnly}
              disabled={favoriteCount === 0 && !favoritesOnly}
            >
              <Star
                size={16}
                className={`mr-2 inline ${favoritesOnly ? "fill-current" : ""}`}
              />
              {t("favorite.only")}
              {favoriteCount > 0 ? ` (${favoriteCount})` : ""}
            </Button>
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-2.5 text-slate-500" size={18} />
              <Input
                ref={searchInputRef}
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder={t("search.character")}
                className="pl-10 bg-slate-950 border-slate-800 text-slate-100 scroll-mt-24"
              />
            </div>
          </div>
        </div>

        <div ref={setRankingControlsTarget} className="space-y-2" />

        {favoritesOnly && total === 0 ? (
          <p className="text-sm text-amber-300/90 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3">
            {t("favorite.emptyList")}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-slate-400">
          <span>
            {favoritesOnly ? t("pagination.favoritesPrefix") : ""}
            {t("pagination.range", {
              total: total.toLocaleString(),
              from: rangeFrom,
              to: rangeTo,
            })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="border-slate-700 bg-slate-950"
              disabled={safePage <= 1}
              onClick={onPrevPage}
            >
              {t("pagination.prev")}
            </Button>
            <span>
              {safePage} / {totalPages}
            </span>
            <Button
              variant="outline"
              className="border-slate-700 bg-slate-950"
              disabled={safePage >= totalPages}
              onClick={onNextPage}
            >
              {t("pagination.next")}
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full min-w-[720px] text-base">
            <thead className="bg-slate-950 text-slate-400">
              <tr>
                <th className="text-center p-3 w-12">
                  <Star size={14} className="inline text-amber-400/80" />
                </th>
                {showGainRank ? (
                  <th className="text-left p-3">{t("table.gainRank")}</th>
                ) : null}
                <th className="text-left p-3">{t("table.levelRank")}</th>
                <th className="text-left p-3">{t("table.character")}</th>
                <th className="text-left p-3">{t("table.server")}</th>
                <th className="text-right p-3 whitespace-nowrap">{t("table.lvExp")}</th>
                <th className="text-right p-3">{t("table.daily")}</th>
                <th className="text-right p-3">{t("table.weekly")}</th>
                <th className="text-right p-3">{t("table.monthly")}</th>
              </tr>
            </thead>
            <tbody>
              {pagedCharacters.map((character) => (
                <tr
                  key={character.id}
                  onClick={() => onRowNavigate(character)}
                  className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/70"
                >
                  <td className="p-3 text-center">
                    <FavoriteStar
                      active={isFavorite(character)}
                      onToggle={() => onToggleFavorite(character)}
                    />
                  </td>
                  {showGainRank ? (
                    <td
                      className={`p-3 font-bold ${gainRankClass(
                        filteredGainRanks.get(character.id)
                      )}`}
                    >
                      #{filteredGainRanks.get(character.id) ?? "-"}
                    </td>
                  ) : null}
                  <td className="p-3 font-bold text-slate-400">#{character.rank}</td>
                  <td className="p-3">
                    <div className="font-semibold">
                      <NavigatorLink
                        href={getNavigatorUrl(character)}
                        className="text-inherit hover:text-sky-300"
                      >
                        {character.name}
                      </NavigatorLink>
                    </div>
                    <div className="text-sm text-slate-400">{formatJobName(character.job)}</div>
                  </td>
                  <td className="p-3">
                    {character.worldId ? (
                      <NavigatorLink
                        href={getNavigatorUrl(character)}
                        className="text-sky-400 font-medium"
                      >
                        {character.worldId}
                      </NavigatorLink>
                    ) : (
                      <span className="text-slate-600">-</span>
                    )}
                  </td>
                  <td className="p-3 text-right font-medium whitespace-nowrap tabular-nums">
                    {formatLevelExp(character)}
                  </td>
                  <td
                    className={`p-3 text-right ${
                      sortKey === "daily" ? "text-emerald-400 font-semibold" : ""
                    }`}
                  >
                    +{formatExp(getGainAmount(character, "daily"))}
                  </td>
                  <td
                    className={`p-3 text-right ${
                      sortKey === "weekly"
                        ? "text-emerald-400 font-semibold"
                        : "text-slate-400"
                    }`}
                  >
                    +{formatExp(character.weeklyGain)}
                  </td>
                  <td
                    className={`p-3 text-right ${
                      sortKey === "monthly"
                        ? "text-emerald-400 font-semibold"
                        : "text-slate-400"
                    }`}
                  >
                    +{formatExp(character.monthlyGain)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
