import { materializeAutomaticShares, resolveDistributionRules } from "./domain/distributionRules.js";

export default function DistributionRuleSettings({ partyOrder, memberMap, setting, updateSetting, t }) {
  const resolved = resolveDistributionRules(partyOrder, setting.taxPercentByMemberId, setting.sharePercentByMemberId);
  const requiresEqualSplit = resolved.ok && resolved.rows.some((row) => row.share?.automatic);
  const ready = resolved.ok && (!requiresEqualSplit || setting.allocationPrepared);
  const hasRuleInput = partyOrder.some((memberId) =>
    String(setting.taxPercentByMemberId[memberId] || "").trim()
    || String(setting.sharePercentByMemberId[memberId] || "").trim());
  const edit = (field, memberId, value) => updateSetting((current) => {
    const next = { ...current[field], [memberId]: value };
    const patch = { [field]: next };
    if (field === "taxPercentByMemberId" && value.trim() !== "") {
      patch.sharePercentByMemberId = { ...current.sharePercentByMemberId, [memberId]: "" };
    }
    return { ...current, ...patch, allocationPrepared: false };
  });
  return <details open={hasRuleInput} className={hasRuleInput
    ? "group rounded-xl border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950/20"
    : "group rounded-xl border-2 border-amber-500 bg-amber-50 shadow-lg ring-2 ring-amber-200/70 dark:border-amber-400 dark:bg-amber-950/30 dark:ring-amber-800/60"}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 marker:content-none [&::-webkit-details-marker]:hidden">
      <span className="flex flex-wrap items-center gap-2">
        {!hasRuleInput ? <span className="rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-black text-white">{t("raffle.distributionRuleNeedsSetup")}</span> : null}
        <strong>{t("raffle.distributionRuleTitle")}</strong>
      </span>
      <span aria-hidden="true" className="text-lg leading-none transition-transform group-open:rotate-180">⌄</span>
    </summary>
    <div className="border-t border-slate-200 p-4 dark:border-slate-700">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="raffle-hint-text">{t("raffle.distributionRuleHelp")}</p>
      <button type="button" className="raffle-button-secondary" disabled={!resolved.ok || !requiresEqualSplit} onClick={() => {
        if (!resolved.ok) return;
        updateSetting((current) => {
          const materialized = materializeAutomaticShares(partyOrder, current.taxPercentByMemberId, current.sharePercentByMemberId);
          return materialized.ok
            ? { ...current, sharePercentByMemberId: materialized.sharePercentByMemberId, allocationPrepared: true }
            : current;
        });
      }}>{t("raffle.splitRemainingEqually")}</button>
    </div>
    <div className="raffle-table-scroll mt-3"><table className="raffle-settlement-table">
      <thead><tr><th>{t("raffle.member")}</th><th>{t("raffle.taxPercent")}</th><th>{t("raffle.sharePercent")}</th><th>{t("raffle.finalSharePercent")}</th></tr></thead>
      <tbody>{partyOrder.map((memberId) => {
        const tax = setting.taxPercentByMemberId[memberId] || "";
        const share = setting.sharePercentByMemberId[memberId] || "";
        const resultRow = resolved.rows?.find((row) => row.memberId === memberId) || null;
        const displayedShare = resultRow?.share?.taxDerived ? resultRow.shareInputText : share;
        return <tr key={memberId}>
          <th scope="row">{memberMap[memberId]?.displayName || memberId}</th>
          <td><input className="raffle-input" inputMode="decimal" value={tax} placeholder="—" aria-label={t("raffle.taxPercentFor", { name: memberMap[memberId]?.displayName || memberId })} onChange={(event) => edit("taxPercentByMemberId", memberId, event.target.value)} /></td>
          <td><input className="raffle-input" inputMode="decimal" value={displayedShare} disabled={tax.trim() !== ""} placeholder={resultRow?.share?.automatic ? t("raffle.autoSharePreview", { percent: resultRow.shareText }) : "—"} aria-label={t("raffle.sharePercentFor", { name: memberMap[memberId]?.displayName || memberId })} onChange={(event) => edit("sharePercentByMemberId", memberId, event.target.value)} /></td>
          <td><strong>{resultRow?.shareText || "—"}</strong></td>
        </tr>;
      })}</tbody>
      <tfoot><tr>
        <th scope="row" colSpan="3">{t("raffle.distributionShareTotal")}</th>
        <td><strong className={!resolved.ok && resolved.totalText ? "text-rose-700 dark:text-rose-300" : ""}>{resolved.totalText || "—"}</strong></td>
      </tr></tfoot>
    </table></div>
    {!resolved.ok ? <div role="alert" className="mt-3 text-sm font-semibold text-rose-700 dark:text-rose-300">{resolved.totalText ? t("raffle.distributionRuleTotalInvalid", { total: resolved.totalText }) : t("raffle.distributionRuleInvalid")}</div> : null}
    {resolved.ok && !ready ? <p className="mt-3 text-sm font-semibold text-amber-700 dark:text-amber-300">{t("raffle.applyDistributionRuleHint")}</p> : null}
    {ready ? <p className="mt-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300">{t("raffle.distributionRuleReady")}</p> : null}
    </div>
  </details>;
}
