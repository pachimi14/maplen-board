import { useTranslation } from "../../i18n/I18nContext.jsx";
import { CUBE_TYPE_DISPLAY_NAMES, CUBE_TYPE_ORDER } from "../domain/cubeSeries.js";

/**
 * IMPL_PLAN_SH45: the legend row IS the comparison control now -- the
 * previous separate `CubeCompareSelector.jsx` (a whole tab-strip control,
 * positioned above the period tabs, far from the chart it fed) is gone;
 * every ADDITIONAL cube type's own legend entry is now a clickable
 * `<button>` that both toggles it (`onToggleAdditional`) and IS its own
 * always-visible key for the chart line below (plan §1: "選ぶ場所と、結果
 * が現れる場所を隣接させる" -- this component is rendered directly above
 * `<SfHistoryChart>` by `CubePricesRoot.jsx`).
 *
 * The MAIN cube type's own entry stays a plain, non-interactive `<span>`
 * (plan (c): "メインはクリックで消せない" -- there is nothing to click),
 * always first, bold, with the "Main" badge -- same "main = most prominent"
 * convention the chart itself uses (thicker line, `MAIN_CUBE_LINE_WIDTH` >
 * `ADDITIONAL_CUBE_LINE_WIDTH`, CubePricesRoot.jsx).
 *
 * ADDITIONAL entries are always all 3 non-main `CUBE_TYPE_ORDER` types, in
 * that fixed order, regardless of selection (plan: "メインを追加として
 * 選べる重複を作らない" is enforced by filtering `mainCubeType` out here,
 * the one place both the old selector and this legend independently did
 * that filtering) -- plan: "色の点は選択に関わらず出す" (the swatch, and
 * the label, are always shown; only `aria-pressed`/`.sfh-cube-legend-item-
 * selected` change with selection, so the row's left-to-right layout never
 * reshuffles or shrinks as the user toggles selections on and off, the
 * same "stable order" property the old CubeLegend already had for its
 * subset of entries).
 *
 * `aria-label` on the group reuses `sfhistoryCube.compare.label` (the old
 * standalone control's own heading) as this row's accessible name -- the
 * translated string stays in active use (plan (g): no residual locale
 * key), it is simply no longer rendered as its own visible line.
 */
export default function CubeLegend({ mainCubeType, additionalCubeTypes, colorByType, onToggleAdditional }) {
  const { t } = useTranslation();
  const additionalOptions = CUBE_TYPE_ORDER.filter((cubeType) => cubeType !== mainCubeType);
  return (
    <div className="sfh-cube-legend" role="group" aria-label={t("sfhistoryCube.compare.label")}>
      <span className="sfh-cube-legend-item sfh-cube-legend-item-main">
        <span className="sfh-cube-swatch" style={{ backgroundColor: colorByType[mainCubeType] }} aria-hidden="true" />
        {CUBE_TYPE_DISPLAY_NAMES[mainCubeType]}
        <span className="sfh-cube-legend-badge">{t("sfhistoryCube.compare.mainBadge")}</span>
      </span>
      {additionalOptions.map((cubeType) => {
        const isOn = additionalCubeTypes.includes(cubeType);
        return (
          <button
            key={cubeType}
            type="button"
            aria-pressed={isOn}
            onClick={() => onToggleAdditional(cubeType)}
            className={`sfh-cube-legend-item sfh-cube-legend-item-toggle ${isOn ? "sfh-cube-legend-item-selected" : ""}`}
          >
            <span className="sfh-cube-swatch" style={{ backgroundColor: colorByType[cubeType] }} aria-hidden="true" />
            {CUBE_TYPE_DISPLAY_NAMES[cubeType]}
          </button>
        );
      })}
    </div>
  );
}
