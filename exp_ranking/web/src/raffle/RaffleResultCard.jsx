import { useTranslation } from "../i18n/I18nContext.jsx";
import { bossMonogram, formatAscendantTierTitle, formatRaffleTimestamp, formatRewardQuantity, groupRaffleResultsForDisplay, groupWonRewards, rewardClassificationLabel, sortAscendantResultsByTier, splitLayerLabel, summarizeRaffleResults } from "./domain/resultDisplay.js";

function RewardIcon({ reward }) {
  if (reward.iconUrl) {
    return <img className="raffle-reward-icon-image" src={reward.iconUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />;
  }
  const fallback = reward.classification === "POWER_CRYSTAL" ? "PC" : reward.classification === "NESO" ? "N" : reward.classification === "COIN" ? "C" : reward.classification === "EQUIPMENT" ? "EQ" : reward.classification === "FT_ITEM" ? "FT" : "•";
  return <span className="raffle-reward-icon-fallback" aria-hidden="true">{fallback}</span>;
}

function RewardGrid({ result }) {
  const rewards = groupWonRewards(result.rewards);
  return (
    <ul className="raffle-reward-grid">
      {rewards.map((reward, index) => (
        <li key={`${result.resultId}-${reward.rewardName}-${index}`} className="raffle-reward-row">
          <span className="raffle-reward-icon"><RewardIcon reward={reward} /></span>
          <span className="raffle-reward-copy">
            <span className="raffle-reward-name">{reward.rewardName}</span>
            <span className={`raffle-reward-kind raffle-reward-kind-${reward.classification.toLocaleLowerCase()}`}>{rewardClassificationLabel(reward.classification)}</span>
          </span>
          <strong className="raffle-reward-quantity"><span aria-hidden="true">×</span> {formatRewardQuantity(reward.quantity)}</strong>
        </li>
      ))}
    </ul>
  );
}

export function RaffleResultSummary({ results }) {
  const { t } = useTranslation();
  const summary = summarizeRaffleResults(results);
  return (
    <details className="raffle-result-summary">
      <summary>
        <span className="raffle-summary-title">{t("raffle.weeklyTotals")}</span>
        <span className="raffle-summary-metrics">
          <span><small>{t("raffle.totalNeso")}</small><strong>{formatRewardQuantity(summary.totalNeso)}</strong></span>
          <span><small>{t("raffle.totalPowerCrystal")}</small><strong>{formatRewardQuantity(summary.totalPowerCrystal)}</strong></span>
        </span>
        <span className="raffle-summary-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div className="raffle-summary-content">
        <h4>{t("raffle.itemTotals")}</h4>
        <RewardGrid result={{ resultId: "weekly-summary", rewards: summary.items }} />
      </div>
    </details>
  );
}

export default function RaffleResultCard({ result }) {
  const bossName = result.bossName || result.layerName || "Unknown";
  const layer = splitLayerLabel(result.layerName, bossName);
  return (
    <article className="raffle-result-card">
      <header className="raffle-result-header">
        <span className="raffle-boss-icon" aria-hidden="true">{bossMonogram(bossName)}</span>
        <div className="raffle-result-title">
          <div className="raffle-result-heading-line">
            <h3>{bossName}</h3>
            {layer.difficulty ? <span className="raffle-difficulty">{layer.difficulty}</span> : null}
          </div>
          {layer.detail ? <p className="raffle-layer-detail">{layer.detail}</p> : null}
          <time dateTime={result.raffledAt}>{formatRaffleTimestamp(result.raffledAt)}</time>
        </div>
        <span className="raffle-win-badge"><span aria-hidden="true">★</span> WIN</span>
      </header>
      <RewardGrid result={result} />
    </article>
  );
}

function AscendantRaffleGroup({ results }) {
  const sortedResults = sortAscendantResultsByTier(results);
  const firstResult = sortedResults[0];
  return (
    <article className="raffle-result-card raffle-ascendant-group">
      <header className="raffle-result-header raffle-ascendant-header">
        <span className="raffle-boss-icon raffle-ascendant-icon" aria-hidden="true">AT</span>
        <div className="raffle-result-title">
          <div className="raffle-result-heading-line"><h3>Ascendant Tier Raffle</h3></div>
          <time dateTime={firstResult.raffledAt}>{formatRaffleTimestamp(firstResult.raffledAt)}</time>
        </div>
        <span className="raffle-win-badge">{sortedResults.length} WINS</span>
      </header>
      <div className="raffle-ascendant-entries">
        {sortedResults.map((result) => {
          const tierName = formatAscendantTierTitle(result.layerName, result.bossName);
          return (
            <section key={result.resultId} className="raffle-ascendant-entry">
              <div className="raffle-ascendant-tier-line">
                <h4>{tierName}</h4>
                <span>WIN</span>
              </div>
              <RewardGrid result={result} />
            </section>
          );
        })}
      </div>
    </article>
  );
}

export function RaffleResultList({ results }) {
  return groupRaffleResultsForDisplay(results).map((group) => group.kind === "ascendant"
    ? <AscendantRaffleGroup key="ascendant-tier-raffle" results={group.results} />
    : <RaffleResultCard key={group.result.resultId} result={group.result} />);
}
