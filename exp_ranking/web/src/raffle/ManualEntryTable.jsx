import { useTranslation } from "../i18n/I18nContext.jsx";
import { MANUAL_COIN_NAME_BY_BOSS, MANUAL_FT_ITEM_NAME } from "./domain/manualClear.js";
import { calculateSaleProceedsNeso } from "./domain/settlement.js";
import { formatNesoInput, neso, ungroupNesoInput } from "./uiText.js";

// LULU-145 (docs/IMPL_PLAN_RAFFLE_MANUAL_MODE.md S2.2): one block per party
// member, showing ONLY the inputs of the items that are checked (`include` is
// the boss-masked include from buildManualClear). Values are stored raw
// (grouping removed); blank = 0, malformed values reach the calculation and
// fail visibly there.

function newRowId() {
  return "row-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function NesoField({ label, value, onChange, preview = false }) {
  const { t } = useTranslation();
  const proceeds = preview ? calculateSaleProceedsNeso(value || "") : null;
  return <label className="raffle-label">
    <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">{label}</span>
    <input className="raffle-input mt-1" inputMode="numeric" value={formatNesoInput(value || "")} placeholder="0" onChange={(event) => onChange(ungroupNesoInput(event.target.value))} />
    {preview ? <span className="raffle-sale-proceeds"><span>{t("raffle.saleProceeds")}</span><strong>{proceeds == null ? "?" : neso(proceeds)}</strong></span> : null}
  </label>;
}

export default function ManualEntryTable({ boss, include = {}, partyOrder = [], memberMap = {}, entriesByAssetKey = {}, onChange }) {
  const { t } = useTranslation();
  const itemLabel = { equipment: t("raffle.item_equipment"), box: t("raffle.item_box") };

  return <div className="raffle-manual-entry space-y-3">
    <h4 className="font-semibold">{t("raffle.manualEntryHeading")}</h4>
    <p className="raffle-hint-text">{t("raffle.manualBlankIsZero")}</p>
    {partyOrder.map((memberId) => {
      const member = memberMap[memberId] || {};
      const assetKey = member.assetKey || memberId;
      const entry = entriesByAssetKey[assetKey] || {};
      const set = (field) => (value) => onChange(assetKey, (current) => ({ ...current, [field]: value }));
      const updateRow = (kind, rowId, patch) => onChange(assetKey, (current) => ({ ...current, [kind]: (current[kind] || []).map((row) => row.rowId === rowId ? { ...row, ...patch } : row) }));
      const counted = (kind, name) => <div key={kind} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" data-manual-field={kind}>
        <NesoField label={t("raffle.item_" + kind) + " (" + name + ") — " + t("raffle.manualQuantity")} value={entry[kind + "Quantity"]} onChange={set(kind + "Quantity")} />
        <NesoField label={t("raffle.manualSaleTotal")} value={entry[kind + "SaleNeso"]} onChange={set(kind + "SaleNeso")} preview />
      </div>;
      const rowList = (kind) => <div key={kind} className="space-y-2" data-manual-field={kind}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">{itemLabel[kind]}</span>
          <button type="button" className="raffle-button-secondary" onClick={() => onChange(assetKey, (current) => ({ ...current, [kind]: [...(current[kind] || []), { rowId: newRowId(), name: "", saleNeso: "" }] }))}>{t("raffle.manualAddRow")}</button>
        </div>
        {(entry[kind] || []).map((row) => <div key={row.rowId} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <label className="raffle-label">
            <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">{t("raffle.manualItemName")}</span>
            <input className="raffle-input mt-1" maxLength={120} value={row.name || ""} placeholder={itemLabel[kind]} onChange={(event) => updateRow(kind, row.rowId, { name: event.target.value })} />
          </label>
          <NesoField label={t("raffle.saleAmount")} value={row.saleNeso} onChange={(value) => updateRow(kind, row.rowId, { saleNeso: value })} preview />
          <button type="button" className="raffle-button-remove" onClick={() => onChange(assetKey, (current) => ({ ...current, [kind]: (current[kind] || []).filter((item) => item.rowId !== row.rowId) }))}>{t("raffle.remove")}</button>
        </div>)}
      </div>;
      return <fieldset key={memberId} className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
        <legend className="px-1 font-semibold">{member.displayName || memberId}</legend>
        {include.bossNeso || include.ascendantNeso || include.powerCrystal ? <div className="grid gap-2 sm:grid-cols-3">
          {include.bossNeso ? <NesoField label={t("raffle.item_bossNeso") + " (NESO)"} value={entry.bossNeso} onChange={set("bossNeso")} /> : null}
          {include.ascendantNeso ? <NesoField label={t("raffle.item_ascendantNeso") + " (NESO)"} value={entry.ascendantNeso} onChange={set("ascendantNeso")} /> : null}
          {include.powerCrystal ? <NesoField label={t("raffle.item_powerCrystal") + " — " + t("raffle.manualQuantity")} value={entry.powerCrystalAmount} onChange={set("powerCrystalAmount")} /> : null}
        </div> : null}
        {include.coin ? counted("coin", MANUAL_COIN_NAME_BY_BOSS[boss] || "Coin") : null}
        {include.equipment ? rowList("equipment") : null}
        {include.box ? rowList("box") : null}
        {include.ftItem ? counted("ftItem", MANUAL_FT_ITEM_NAME) : null}
      </fieldset>;
    })}
  </div>;
}
