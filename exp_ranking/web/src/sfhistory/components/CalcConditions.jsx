import { useTranslation } from "../../i18n/I18nContext.jsx";
import { formatTimestamp } from "../domain/format.js";

// IMPL_PLAN_SH5 §2 / design §8.2 §11: fixed, non-evaluative list of the
// assumptions baked into `expectedStarforceCostExact`'s default arguments
// (starforce.js header) plus provenance timestamps and the policy version
// string design §8.2 says must be shown verbatim.
export const POLICY_VERSION = "starcatch-chancetime-no-safeguard-v1";

export default function CalcConditions({ historyUpdatedAt, currentFetchedAt }) {
  const { t } = useTranslation();
  return (
    <div>
      <h2 className="sfh-field-label mb-1.5">{t("sfhistory.conditions.title")}</h2>
      <dl className="sfh-conditions-list">
        {(() => {
          const lines = [
            t("sfhistory.conditions.starCatch"),
            t("sfhistory.conditions.chanceTime"),
            t("sfhistory.conditions.safeguard"),
            t("sfhistory.conditions.eventAdjustment"),
            t("sfhistory.conditions.metric"),
            t("sfhistory.conditions.interval"),
            historyUpdatedAt ? t("sfhistory.conditions.historyUpdatedAt", { date: formatTimestamp(historyUpdatedAt) }) : null,
            currentFetchedAt ? t("sfhistory.conditions.currentFetchedAt", { date: formatTimestamp(currentFetchedAt) }) : null,
            t("sfhistory.conditions.policyVersion", { version: POLICY_VERSION }),
          ].filter(Boolean);
          return lines.map((line, index) => (
            <dd key={index}>
              {line}
              {index < lines.length - 1 ? " ·" : ""}
            </dd>
          ));
        })()}
      </dl>
    </div>
  );
}
