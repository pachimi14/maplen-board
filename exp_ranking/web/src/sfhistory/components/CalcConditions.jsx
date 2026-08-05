import { useTranslation } from "../../i18n/I18nContext.jsx";
import { formatTimestamp, formatTimeZoneLabel, localTimeZone } from "../domain/format.js";

// IMPL_PLAN_SH5 §2 / design §8.2 §11: fixed, non-evaluative list of the
// assumptions baked into `expectedStarforceCostExact`'s default arguments
// (starforce.js header) plus provenance timestamps and the policy version
// string design §8.2 says must be shown verbatim.
export const POLICY_VERSION = "starcatch-chancetime-no-safeguard-v1";

// IMPL_PLAN_SH11 §2/(c): resolved once per module load (stable for the
// session) -- the viewer's own IANA zone, used both for the two timestamp
// rows below and the explicit "表示時刻: ... (UTC+9)" disclosure row.
const CONDITIONS_TIME_ZONE = localTimeZone();

export default function CalcConditions({ historyUpdatedAt, currentFetchedAt }) {
  const { t, language } = useTranslation();
  return (
    <div>
      <h2 className="sfh-field-label mb-1.5">{t("sfhistory.conditions.title")}</h2>
      <dl className="sfh-conditions-list">
        {(() => {
          const dateOptions = { locale: language, timeZone: CONDITIONS_TIME_ZONE };
          const lines = [
            t("sfhistory.conditions.starCatch"),
            t("sfhistory.conditions.chanceTime"),
            t("sfhistory.conditions.safeguard"),
            t("sfhistory.conditions.eventAdjustment"),
            t("sfhistory.conditions.metric"),
            t("sfhistory.conditions.interval"),
            // IMPL_PLAN_SH11 §2/(c): "どのタイムゾーンで見ているか分からな
            // い画面にしない" -- the one, explicit disclosure the plan asks
            // for, right alongside the two timestamps it applies to.
            t("sfhistory.conditions.displayTimeZone", { zone: formatTimeZoneLabel(CONDITIONS_TIME_ZONE) }),
            historyUpdatedAt ? t("sfhistory.conditions.historyUpdatedAt", { date: formatTimestamp(historyUpdatedAt, dateOptions) }) : null,
            currentFetchedAt ? t("sfhistory.conditions.currentFetchedAt", { date: formatTimestamp(currentFetchedAt, dateOptions) }) : null,
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
