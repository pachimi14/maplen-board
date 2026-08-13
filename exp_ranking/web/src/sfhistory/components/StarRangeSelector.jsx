import { useTranslation } from "../../i18n/I18nContext.jsx";
import { isPresetEnabled, startStarOptions, STAR_RANGE_PRESETS, targetStarOptions } from "../domain/series.js";

// IMPL_PLAN_SH5 §2 / design §7.1: the single most safety-critical piece of
// this screen. `maxStar` is the data-derived ceiling from
// `/sf-history/equipment` (never hardcoded) -- every option offered here,
// and every preset's enabled/disabled state, is bounded by it so the user
// can never end up on a span the chart cannot render (all-null series).
export default function StarRangeSelector({ maxStar, startStar, targetStar, onChange }) {
  const { t } = useTranslation();
  const starts = startStarOptions(maxStar);
  const targets = targetStarOptions(maxStar).filter((star) => star > startStar);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="sfh-select-group">
          <span className="sfh-field-label">{t("sfhistory.starRange.startLabel")}</span>
          <select
            className="sfh-select"
            value={startStar}
            onChange={(event) => {
              const nextStart = Number(event.target.value);
              const nextTarget = targetStar > nextStart ? Math.min(targetStar, maxStar) : Math.min(nextStart + 1, maxStar);
              onChange({ startStar: nextStart, targetStar: nextTarget });
            }}
          >
            {starts.map((star) => (
              <option key={star} value={star}>
                {star}
              </option>
            ))}
          </select>
        </label>
        <label className="sfh-select-group">
          <span className="sfh-field-label">{t("sfhistory.starRange.targetLabel")}</span>
          <select
            className="sfh-select"
            value={targetStar}
            onChange={(event) => onChange({ startStar, targetStar: Number(event.target.value) })}
          >
            {targets.map((star) => (
              <option key={star} value={star}>
                {star}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="sfh-field-label mr-1">{t("sfhistory.starRange.presetsLabel")}</span>
        {STAR_RANGE_PRESETS.map((preset) => {
          const enabled = isPresetEnabled(preset, maxStar);
          const active = preset.from === startStar && preset.to === targetStar;
          return (
            <button
              key={`${preset.from}-${preset.to}`}
              type="button"
              disabled={!enabled}
              onClick={() => onChange({ startStar: preset.from, targetStar: preset.to })}
              className={`sfh-preset-chip ${active ? "sfh-preset-chip-active" : ""}`}
              title={enabled ? undefined : t("sfhistory.starRange.presetDisabledHint", { maxStar })}
            >
              {preset.from}→{preset.to}
            </button>
          );
        })}
      </div>
    </div>
  );
}
