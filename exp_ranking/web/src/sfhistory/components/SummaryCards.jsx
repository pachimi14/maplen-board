import { useTranslation } from "../../i18n/I18nContext.jsx";
import { formatCompactNeso, formatExactNeso } from "../domain/format.js";

// IMPL_PLAN_SH5 §2 / design §11: Current / Period Average / Period High /
// Period Low / Current Position(percentile). Design §11 forbids any
// recommending copy ("今強化すべき" etc.) -- this component only ever
// renders numbers and the fixed labels above, nothing evaluative.
function SummaryCard({ label, value, title, tone = "" }) {
  return (
    <div className="sfh-summary-card">
      <div className="sfh-summary-label">{label}</div>
      <div className={`sfh-summary-value ${tone}`} title={title}>
        {value}
      </div>
    </div>
  );
}

export default function SummaryCards({ currentStatus, currentExpected, stats, percentile }) {
  const { t } = useTranslation();

  const currentValue = currentStatus === "ready" && currentExpected != null
    ? formatCompactNeso(currentExpected)
    : t("sfhistory.summary.currentUnavailable");
  const currentTitle = currentStatus === "ready" && currentExpected != null
    ? formatExactNeso(currentExpected)
    : t("sfhistory.summary.currentUnavailableHint");

  const hasStats = stats.count > 0;

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      <SummaryCard
        label={t("sfhistory.summary.current")}
        value={currentValue}
        title={currentTitle}
        tone={currentStatus === "ready" && currentExpected != null ? "text-cyan-300" : "text-amber-400 text-sm"}
      />
      <SummaryCard
        label={t("sfhistory.summary.periodAverage")}
        value={hasStats ? formatCompactNeso(stats.average) : t("sfhistory.summary.noConfirmedData")}
        title={hasStats ? formatExactNeso(stats.average) : undefined}
      />
      <SummaryCard
        label={t("sfhistory.summary.periodHigh")}
        value={hasStats ? formatCompactNeso(stats.high) : "--"}
        title={hasStats ? formatExactNeso(stats.high) : undefined}
      />
      <SummaryCard
        label={t("sfhistory.summary.periodLow")}
        value={hasStats ? formatCompactNeso(stats.low) : "--"}
        title={hasStats ? formatExactNeso(stats.low) : undefined}
      />
      <SummaryCard
        label={t("sfhistory.summary.currentPosition")}
        value={
          percentile != null
            ? t("sfhistory.summary.percentileValue", { percentile: Math.round(percentile) })
            : "--"
        }
        tone="text-sm"
      />
    </div>
  );
}
