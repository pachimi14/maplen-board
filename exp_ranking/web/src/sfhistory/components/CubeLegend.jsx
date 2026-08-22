import { useTranslation } from "../../i18n/I18nContext.jsx";
import { CUBE_TYPE_DISPLAY_NAMES } from "../domain/cubeSeries.js";

/**
 * IMPL_PLAN_SH44 §2-2 (d): "凡例が必須" -- once a cube line's color carries
 * meaning (which cube it is), the reader needs a key to read it by. A
 * SEPARATE component from `SfHistoryChart.jsx` on purpose (not folded into
 * that shared component) -- keeps `SfHistoryChart.jsx`'s own JSX output,
 * for a call with no `extraSeries`, exactly what it was before this plan
 * (plan (j)); this is cube-page-only chrome, rendered by `CubePricesRoot.jsx`
 * itself, directly above the chart it describes.
 *
 * The main cube type always renders first and bold (`sfh-cube-legend-main`)
 * -- same "main = most prominent" convention the chart itself uses (thicker
 * line); additional types follow in `CUBE_TYPE_ORDER` order (stable,
 * matches `CubeCompareSelector.jsx`'s own button order) so the legend's
 * left-to-right order never reshuffles as the user toggles selections on
 * and off.
 */
export default function CubeLegend({ mainCubeType, additionalCubeTypes, colorByType }) {
  const { t } = useTranslation();
  return (
    <div className="sfh-cube-legend">
      <span className="sfh-cube-legend-item sfh-cube-legend-item-main">
        <span className="sfh-cube-swatch" style={{ backgroundColor: colorByType[mainCubeType] }} aria-hidden="true" />
        {CUBE_TYPE_DISPLAY_NAMES[mainCubeType]}
        <span className="sfh-cube-legend-badge">{t("sfhistoryCube.compare.mainBadge")}</span>
      </span>
      {additionalCubeTypes.map((cubeType) => (
        <span key={cubeType} className="sfh-cube-legend-item">
          <span className="sfh-cube-swatch" style={{ backgroundColor: colorByType[cubeType] }} aria-hidden="true" />
          {CUBE_TYPE_DISPLAY_NAMES[cubeType]}
        </span>
      ))}
    </div>
  );
}
