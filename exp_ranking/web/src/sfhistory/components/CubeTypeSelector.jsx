import { useTranslation } from "../../i18n/I18nContext.jsx";
import { CUBE_TYPE_DISPLAY_NAMES, CUBE_TYPE_ORDER } from "../domain/cubeSeries.js";

/**
 * IMPL_PLAN_SH41 §3: which of the 4 cube sub-types (Red / Black / Bonus
 * Potential / White) the chart/summary/heatmap below are showing. Reuses
 * `PeriodTabs.jsx`'s exact `.sfh-select-group` / `.sfh-field-label` /
 * `.sfh-period-tabs` / `.sfh-period-tab*` classes -- the same pill-button
 * visual language, no new CSS invented for a 4th kind of tab strip. Only
 * `label`/`value`/`onChange` differ from `PeriodTabs`; the display names
 * come from `CUBE_TYPE_DISPLAY_NAMES` (domain/cubeSeries.js), not i18n --
 * see that constant's own comment for why (in-game item names stay English
 * in every locale, same as equipment names elsewhere in this app).
 */
export default function CubeTypeSelector({ value, onChange }) {
  const { t } = useTranslation();
  return (
    <div className="sfh-select-group">
      <span className="sfh-field-label">{t("sfhistoryCube.cubeType.label")}</span>
      <div className="sfh-period-tabs" role="tablist">
        {CUBE_TYPE_ORDER.map((cubeType) => (
          <button
            key={cubeType}
            type="button"
            role="tab"
            aria-selected={value === cubeType}
            onClick={() => onChange(cubeType)}
            className={`sfh-period-tab ${value === cubeType ? "sfh-period-tab-active" : ""}`}
          >
            {CUBE_TYPE_DISPLAY_NAMES[cubeType]}
          </button>
        ))}
      </div>
    </div>
  );
}
