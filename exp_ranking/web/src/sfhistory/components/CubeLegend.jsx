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
 *
 * IMPL_PLAN_SH45 revision (統括 差し戻し, "(b) が満たせていません" --
 * `.sfh-cube-legend-item-selected`'s CSS `border-color`/`background` never
 * rendered visibly): the selected border/background are now set as an
 * INLINE style, computed here from the exact same `colorByType` map the
 * swatch beside it already uses -- an inline `style` always wins the CSS
 * cascade over ANY external stylesheet rule (no dependency on selector
 * specificity, source order, or `@layer`, all of which were candidate
 * explanations that didn't fully account for what was measured), and it is
 * what makes "選択中は枠を付ける" testable directly off this component's
 * own SSR output (`CubeLegend.test.js`) without needing a real browser's
 * CSS engine. `border-color`/`background` also now use the SAME resolved
 * cube color the swatch/chart line already use (統括 instruction: "枠の色
 * はそのキューブの色を使う... 凡例の点と対応が取れる"), not the generic
 * `--theme-focus` accent -- those hex values are the exact ones
 * `domain/cubeSeries.js#CUBE_TYPE_COLORS`'s own header already measured at
 * >=3:1 WCAG contrast against both this screen's dark and light
 * backgrounds (SH-44 completion report), so reusing them here for a
 * *border* (a non-text use, the same bar that report measured against)
 * carries that same guarantee forward without a new measurement pass per
 * color. Font-weight stays a CSS class rule (`sfh-cube-legend-item-
 * selected`, unchanged) -- 統括's own measurement showed that ONE property
 * WAS applying correctly (400 -> 700), so it is not what needed to move.
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
        const cubeColor = colorByType[cubeType];
        return (
          <button
            key={cubeType}
            type="button"
            aria-pressed={isOn}
            onClick={() => onToggleAdditional(cubeType)}
            className={`sfh-cube-legend-item sfh-cube-legend-item-toggle ${isOn ? "sfh-cube-legend-item-selected" : ""}`}
            style={
              isOn
                ? { borderColor: cubeColor, backgroundColor: `color-mix(in srgb, ${cubeColor} 18%, transparent)` }
                : undefined
            }
          >
            <span className="sfh-cube-swatch" style={{ backgroundColor: cubeColor }} aria-hidden="true" />
            {CUBE_TYPE_DISPLAY_NAMES[cubeType]}
          </button>
        );
      })}
    </div>
  );
}
