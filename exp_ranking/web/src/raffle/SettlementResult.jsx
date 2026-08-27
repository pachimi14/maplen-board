import { useState } from "react";
import { useTranslation } from "../i18n/I18nContext.jsx";
import {
  buildTransferNotificationText,
  describeMemberSettlement,
  formatNeso,
  memberDisplayName as memberName,
  neso,
  pcPortionAmount,
  resolveMemberWallet,
  settlementMemberCategoryCell,
  signedNeso,
} from "./uiText.js";
import { buildSettlementShareModel, renderSettlementShareImageBlob, settlementShareFileName } from "./shareImage.js";
import { copyPngBlobToClipboard, copyTextToClipboard, downloadBlob } from "../shareImageIO.js";

function EquipmentIcons({ drops }) {
  if (!drops?.length) return <span className="raffle-empty-value">—</span>;
  return <span className="raffle-equipment-icons">{drops.map((drop) => {
    const tooltip = drop.name + (drop.quantity !== "1" ? " × " + formatNeso(drop.quantity) : "");
    return <span key={drop.dropId} className="raffle-equipment-item" title={tooltip} aria-label={tooltip}>
      {drop.imageUrl ? <img src={drop.imageUrl} alt="" /> : <span className="raffle-equipment-fallback">EQ</span>}
      {drop.quantity !== "1" ? <b>×{formatNeso(drop.quantity)}</b> : null}
    </span>;
  })}</span>;
}

export default function SettlementResult({ calculation, include, memberMap, memberWallets = {}, powerCrystalNesoRate, bossLabel = "", roundLocalText = "", roundUtcText = "" }) {
  const { t } = useTranslation();
  const [shareBusy, setShareBusy] = useState(false);
  const [shareStatus, setShareStatus] = useState("idle");
  const [transferCopyBusy, setTransferCopyBusy] = useState(false);
  const [transferCopyStatus, setTransferCopyStatus] = useState("idle");
  const categoryColumns = [
    include.bossNeso ? { key: "bossNeso", label: t("raffle.item_bossNeso"), total: calculation.categoryTotals.bossNeso } : null,
    include.powerCrystal ? { key: "powerCrystal", label: t("raffle.item_powerCrystal"), total: calculation.categoryTotals.powerCrystalNeso } : null,
    include.ascendantNeso ? { key: "ascendantNeso", label: t("raffle.item_ascendantNeso"), total: calculation.categoryTotals.ascendantNeso } : null,
    include.coin ? { key: "coin", label: t("raffle.item_coin"), total: calculation.categoryTotals.coinSaleNeso } : null,
    include.equipment ? { key: "equipment", label: t("raffle.item_equipment"), total: calculation.categoryTotals.equipmentSaleNeso } : null,
    include.ftItem ? { key: "ftItem", label: t("raffle.item_ftItem"), total: calculation.categoryTotals.ftItemSaleNeso } : null,
    // docs/IMPL_PLAN_RAFFLE_EXTRA_REWARD.md: extra reward has no include
    // toggle (it isn't a boss-drop category) -- its column/row only shows up
    // once the party has actually entered a non-zero extra reward this week,
    // so a party that never uses it sees the exact same table it always has.
    calculation.categoryTotals.extraReward !== "0" ? { key: "extraReward", label: t("raffle.item_extraReward"), total: calculation.categoryTotals.extraReward } : null,
  ].filter(Boolean);

  function categoryQuantity(category) {
    if (category.key === "powerCrystal") return <><strong>{formatNeso(calculation.categoryTotals.powerCrystalAmount)} PC ÷ {powerCrystalNesoRate}</strong><small>{t("raffle.powerCrystalNonTransferable")}</small></>;
    if (category.key === "coin") return <strong>× {formatNeso(calculation.categoryTotals.coinQuantity)}</strong>;
    if (category.key === "equipment") return <EquipmentIcons drops={calculation.equipmentDrops} />;
    if (category.key === "ftItem") return <strong>× {formatNeso(calculation.categoryTotals.ftItemQuantity)}</strong>;
    return <span className="raffle-empty-value">—</span>;
  }

  // Equipment keeps its own icon rendering here (canvas-drawn text in the
  // share image can't show icons, so shareImage.js's C4 member table uses
  // settlementMemberCategoryCell's text-only equipment cell instead). Every
  // other category defers to the shared settlementMemberCategoryCell so this
  // table and the share-image member table can never disagree about a
  // member's cell value.
  function memberCategoryValue(member, key) {
    if (key === "equipment") {
      return <><EquipmentIcons drops={member.equipmentDrops} />{member.equipmentDrops.length ? <small>{neso(member.equipmentSaleNeso)}</small> : null}</>;
    }
    const cell = settlementMemberCategoryCell(member, key, { powerCrystalNesoRate });
    if (cell.zero) return <span className="raffle-zero-value">0</span>;
    return <><strong>{cell.primary}</strong>{cell.secondary ? <small>{cell.secondary}</small> : null}</>;
  }

  function carryoverBadge(value) {
    const amount = BigInt(value);
    const className = amount > 0n ? "raffle-carryover-receive" : amount < 0n ? "raffle-carryover-pay" : "raffle-carryover-zero";
    return <span className={className}>{signedNeso(value)}</span>;
  }

  function settlementBadgeClassName(member) {
    const kind = describeMemberSettlement(member, { t, carryoverEnabled: calculation.carryoverEnabled }).kind;
    if (kind === "pays") return "raffle-payment";
    if (kind === "receives") return "raffle-receipt";
    return "raffle-settled";
  }

  function settlementBadgeContent(member) {
    const info = describeMemberSettlement(member, { t, carryoverEnabled: calculation.carryoverEnabled });
    return info.amount != null ? <>{info.label}<strong>{neso(info.amount)}</strong></> : info.label;
  }

  async function handleCopyResultImage() {
    if (shareBusy) return;
    setShareBusy(true);
    setShareStatus("generating");
    try {
      const model = buildSettlementShareModel(calculation, memberMap, include, powerCrystalNesoRate, t, {
        bossLabel,
        roundLocalText,
        roundUtcText,
        memberWallets,
      });
      const blob = await renderSettlementShareImageBlob(model);
      const copied = await copyPngBlobToClipboard(blob);
      if (copied) {
        setShareStatus("copied");
      } else {
        downloadBlob(blob, settlementShareFileName());
        setShareStatus("downloadedFallback");
      }
    } catch {
      setShareStatus("failed");
    } finally {
      setShareBusy(false);
    }
  }

  // LULU-103: one-button Discord/manual transfer notification copy, so
  // members no longer hand-type "SENDER → RECEIVER amount NESO" + wallet
  // while reading the settlement table.
  async function handleCopyTransferNotification() {
    if (transferCopyBusy) return;
    setTransferCopyBusy(true);
    try {
      const text = buildTransferNotificationText(calculation.transfers, memberMap, memberWallets, { t });
      const copied = await copyTextToClipboard(text);
      setTransferCopyStatus(copied ? "copied" : "failed");
    } catch {
      setTransferCopyStatus("failed");
    } finally {
      setTransferCopyBusy(false);
    }
  }

  const missingWalletTransferCount = calculation.transfers.filter(
    (transfer) => !resolveMemberWallet(memberWallets, transfer.toMemberId),
  ).length;

  return (
    <article className="raffle-settlement-result">
      <div className="raffle-settlement-header">
        <h3>{t("raffle.settlementSummary")}</h3>
        <button type="button" className="raffle-button-secondary raffle-share-image-button" disabled={shareBusy} onClick={handleCopyResultImage}>
          {t("raffle.copyResultImage")}
        </button>
      </div>
      {shareStatus !== "idle" ? <p role="status" className="raffle-share-status">
        {shareStatus === "generating" ? t("raffle.shareImageGenerating") : null}
        {shareStatus === "copied" ? t("raffle.shareImageCopied") : null}
        {shareStatus === "downloadedFallback" ? t("raffle.shareImageDownloadedFallback") : null}
        {shareStatus === "failed" ? t("raffle.shareImageFailed") : null}
      </p> : null}

      <div className="raffle-hero-metrics">
        <div className="raffle-hero-tile">
          <span>{t("raffle.total")}</span>
          <strong>{neso(calculation.total)}</strong>
        </div>
        <div className="raffle-hero-tile">
          <span>{t("raffle.baseShare")}</span>
          <strong>{neso(calculation.baseShare)}</strong>
        </div>
      </div>

      <div className="raffle-sub-metrics">
        <span className="raffle-sub-metric"><small>{t("raffle.transferableNeso")}</small><strong>{neso(calculation.categoryTotals.transferableNeso)}</strong></span>
        <span className="raffle-sub-metric"><small>{t("raffle.distributionMembers")}</small><strong>{calculation.memberCount}</strong></span>
        <span className="raffle-sub-metric"><small>{t("raffle.remainder")}</small><strong>{neso(calculation.remainder)}</strong></span>
        {calculation.carryoverEnabled ? <span className="raffle-sub-metric raffle-sub-metric-note">{t("raffle.carryoverEnabled")}</span> : null}
      </div>

      <p className="raffle-settlement-formula">{t("raffle.settlementFormula")}</p>

      <section className="raffle-settlement-section raffle-member-cards-section">
        <div className="raffle-member-cards">
          {calculation.members.map((member) => {
            const pcAmount = pcPortionAmount(member);
            return <article key={member.memberId} className="raffle-member-card">
              <header className="raffle-member-card-header">
                <h4>{memberName(memberMap, member.memberId)}</h4>
                {!member.hasHistory ? <span className="raffle-history-no">{t("raffle.historyNo")}</span> : null}
              </header>
              <p className="raffle-member-card-gross">{t("raffle.grossWon")}: <strong>{neso(member.gross)}</strong></p>
              {pcAmount != null ? <p className="raffle-member-card-pc-note">{t("raffle.pcPortionNote", { amount: neso(pcAmount) })}</p> : null}
              <div className="raffle-member-card-settle">
                <span className={settlementBadgeClassName(member) + " raffle-badge-lg"}>{settlementBadgeContent(member)}</span>
              </div>
              {calculation.carryoverEnabled ? <p className="raffle-member-card-carryover">{t("raffle.nextCarryover")}: {carryoverBadge(member.nextCarryover)}</p> : null}
            </article>;
          })}
        </div>
      </section>

      <section className="raffle-settlement-section raffle-actual-transfers-section">
        <div className="raffle-actual-transfers-header">
          <h4>{t("raffle.actualTransfers")}</h4>
          {calculation.transfers.length ? <button type="button" className="raffle-button-secondary raffle-copy-transfer-button" disabled={transferCopyBusy} onClick={handleCopyTransferNotification}>
            {t("raffle.copyTransferNotification")}
          </button> : null}
        </div>
        {missingWalletTransferCount > 0 ? <p role="status" className="raffle-transfer-wallet-warning">{t("raffle.missingTransferWalletWarning")}</p> : null}
        {transferCopyStatus !== "idle" ? <p role="status" className="raffle-share-status">
          {transferCopyStatus === "copied" ? t("raffle.transferNotificationCopied") : null}
          {transferCopyStatus === "failed" ? t("raffle.transferNotificationFailed") : null}
        </p> : null}
        {calculation.transfers.length ? <div className="raffle-table-scroll raffle-table-scroll--compact">
          <table className="raffle-settlement-table raffle-transfer-table">
            <thead><tr>
              <th>{t("raffle.payer")} → {t("raffle.receiver")}</th>
              <th>{t("raffle.amount")}</th>
              <th>{t("raffle.receiverWallet")}</th>
            </tr></thead>
            <tbody>{calculation.transfers.map((transfer, index) => {
              const wallet = resolveMemberWallet(memberWallets, transfer.toMemberId);
              return <tr key={transfer.fromMemberId + ":" + transfer.toMemberId + ":" + index}>
                <th scope="row" className="raffle-transfer-names">
                  <span className="raffle-transfer-payer">{memberName(memberMap, transfer.fromMemberId)}</span>
                  <span className="raffle-transfer-arrow" aria-hidden="true">→</span>
                  <span className="raffle-transfer-receiver">{memberName(memberMap, transfer.toMemberId)}</span>
                </th>
                <td className="raffle-strong-amount">{neso(transfer.amount)}</td>
                <td className="raffle-transfer-wallet-cell">{wallet || t("raffle.walletUnavailable")}</td>
              </tr>;
            })}</tbody>
          </table>
        </div> : <p className="raffle-no-transfers">{t("raffle.noTransfers")}</p>}
      </section>

      <section className="raffle-settlement-section raffle-breakdown-section">
        <h4>{t("raffle.breakdownHeading")}</h4>

        <div className="raffle-breakdown-subsection">
          <h5>{t("raffle.categoryBreakdown")}</h5>
          <div className="raffle-table-scroll raffle-table-scroll--compact">
            <table className="raffle-settlement-table raffle-category-table">
              <thead><tr><th>{t("raffle.category")}</th><th>{t("raffle.quantity")}</th><th>{t("raffle.nesoValue")}</th></tr></thead>
              <tbody>
                {categoryColumns.map((category) => <tr key={category.key}>
                  <th scope="row">{category.label}</th>
                  <td className="raffle-category-quantity">{categoryQuantity(category)}</td>
                  <td>{neso(category.total)}</td>
                </tr>)}
              </tbody>
              <tfoot><tr><th scope="row" colSpan="2">{t("raffle.total")}</th><td>{neso(calculation.total)}</td></tr></tfoot>
            </table>
          </div>
        </div>

        <div className="raffle-breakdown-subsection">
          <h5>{t("raffle.memberBreakdown")}</h5>
          <div className="raffle-table-scroll">
            <table className="raffle-settlement-table raffle-member-table">
              <thead><tr>
                <th>{t("raffle.member")}</th>
                <th>{t("raffle.raffleHistory")}</th>
                {calculation.carryoverEnabled ? <th>{t("raffle.previousCarryover")}</th> : null}
                {categoryColumns.map((category) => <th key={category.key}>{category.label}{category.key === "powerCrystal" ? <small className="raffle-th-note">{t("raffle.powerCrystalNonTransferable")}</small> : null}</th>)}
                <th className="raffle-col-settle">{t("raffle.grossWon")}</th>
                <th className="raffle-col-settle">{t("raffle.assignedShare")}</th>
                <th className="raffle-col-settle">{t("raffle.settlement")}</th>
                {calculation.carryoverEnabled ? <th className="raffle-col-settle">{t("raffle.nextCarryover")}</th> : null}
              </tr></thead>
              <tbody>{calculation.members.map((member) => <tr key={member.memberId}>
                <th scope="row">{memberName(memberMap, member.memberId)}</th>
                <td><span className={member.hasHistory ? "raffle-history-yes" : "raffle-history-no"}>{t(member.hasHistory ? "raffle.historyYes" : "raffle.historyNo")}</span></td>
                {calculation.carryoverEnabled ? <td>{carryoverBadge(member.previousCarryover)}</td> : null}
                {categoryColumns.map((category) => <td key={category.key} className="raffle-member-amount">{memberCategoryValue(member, category.key)}</td>)}
                <td className="raffle-strong-amount raffle-col-settle">{neso(member.gross)}</td>
                <td className="raffle-strong-amount raffle-col-settle">{neso(member.assignedShare)}</td>
                <td className="raffle-col-settle"><span className={settlementBadgeClassName(member)}>{settlementBadgeContent(member)}</span></td>
                {calculation.carryoverEnabled ? <td className="raffle-col-settle">{carryoverBadge(member.nextCarryover)}</td> : null}
              </tr>)}</tbody>
            </table>
          </div>
        </div>
      </section>
    </article>
  );
}
