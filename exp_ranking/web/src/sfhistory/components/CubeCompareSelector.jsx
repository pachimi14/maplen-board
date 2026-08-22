import { useTranslation } from "../../i18n/I18nContext.jsx";
import { CUBE_TYPE_DISPLAY_NAMES, CUBE_TYPE_ORDER } from "../domain/cubeSeries.js";

/**
 * IMPL_PLAN_SH44 §2-1: a SEPARATE control from `CubeTypeSelector.jsx` --
 * that one still decides the single MAIN cube type (unchanged, plan §2-1's
 * own "メインの選択は現状のまま"); this one decides 0-3 ADDITIONAL cube
 * types to overlay on top of it. Deliberately never offers `mainCubeType`
 * itself as a toggle option (plan §2-1: "メインを追加でも選べる、という
 * 重複を作らない") -- its own button list is always `CUBE_TYPE_ORDER` minus
 * whichever one is currently main, so the same cube type can never appear
 * selected in both controls at once.
 *
 * Reuses the exact same `.sfh-select-group`/`.sfh-field-label`/
 * `.sfh-period-tabs`/`.sfh-period-tab*` classes `CubeTypeSelector.jsx`
 * already reuses from `PeriodTabs.jsx` -- no new tab-strip visual language,
 * only a small color swatch (`.sfh-cube-swatch`, sfhistory.css) added in
 * front of each label, tinted with that button's own resolved cube color
 * (`colorByType`, `domain/cubeSeries.js#resolveCubeColor`, already computed
 * once by the caller) -- so a selected button visually previews the exact
 * line color it will add to the chart below, the same color the legend
 * (`CubeLegend.jsx`) shows for it.
 */
export default function CubeCompareSelector({ mainCubeType, selected, colorByType, onToggle }) {
  const { t } = useTranslation();
  const options = CUBE_TYPE_ORDER.filter((cubeType) => cubeType !== mainCubeType);
  return (
    <div className="sfh-select-group">
      <span className="sfh-field-label">{t("sfhistoryCube.compare.label")}</span>
      <div className="sfh-period-tabs" role="group">
        {options.map((cubeType) => {
          const isOn = selected.includes(cubeType);
          return (
            <button
              key={cubeType}
              type="button"
              aria-pressed={isOn}
              onClick={() => onToggle(cubeType)}
              className={`sfh-period-tab ${isOn ? "sfh-period-tab-active" : ""}`}
            >
              <span
                className="sfh-cube-swatch"
                style={{ backgroundColor: colorByType[cubeType], opacity: isOn ? 1 : 0.45 }}
                aria-hidden="true"
              />
              {CUBE_TYPE_DISPLAY_NAMES[cubeType]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
