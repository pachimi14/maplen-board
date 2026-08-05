import { useTranslation } from "../../i18n/I18nContext.jsx";
import { PERIOD_KEYS } from "../domain/series.js";

// IMPL_PLAN_SH29 §3 (2026-08-06, user decision): adds "14D".
const LABEL_KEY_BY_PERIOD = {
  "7D": "sfhistory.period.d7",
  "14D": "sfhistory.period.d14",
  "30D": "sfhistory.period.d30",
  "90D": "sfhistory.period.d90",
  "150D": "sfhistory.period.d150",
};

export default function PeriodTabs({ value, onChange }) {
  const { t } = useTranslation();
  return (
    <div className="sfh-select-group">
      <span className="sfh-field-label">{t("sfhistory.period.label")}</span>
      <div className="sfh-period-tabs" role="tablist">
        {PERIOD_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={value === key}
            onClick={() => onChange(key)}
            className={`sfh-period-tab ${value === key ? "sfh-period-tab-active" : ""}`}
          >
            {t(LABEL_KEY_BY_PERIOD[key])}
          </button>
        ))}
      </div>
    </div>
  );
}
