import { useTranslation } from "../i18n/I18nContext.jsx";

function formatNeso(value) {
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    return String(value ?? "");
  }
}

function memberName(memberMap, memberId) {
  return memberMap?.[memberId]?.displayName || memberId;
}

function neso(value) {
  return formatNeso(value) + " NESO";
}

function signedNeso(value) {
  try {
    const amount = BigInt(value);
    return (amount > 0n ? "+" : "") + amount.toLocaleString("en-US") + " NESO";
  } catch {
    return String(value ?? "") + " NESO";
  }
}

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

export default function SettlementResult({ calculation, include, memberMap, powerCrystalNesoRate }) {
  const { t } = useTranslation();
  const categoryColumns = [
    include.bossNeso ? { key: "bossNeso", label: t("raffle.item_bossNeso"), total: calculation.categoryTotals.bossNeso } : null,
    include.powerCrystal ? { key: "powerCrystal", label: t("raffle.item_powerCrystal"), total: calculation.categoryTotals.powerCrystalNeso } : null,
    include.ascendantNeso ? { key: "ascendantNeso", label: t("raffle.item_ascendantNeso"), total: calculation.categoryTotals.ascendantNeso } : null,
    include.coin ? { key: "coin", label: t("raffle.item_coin"), total: calculation.categoryTotals.coinSaleNeso } : null,
    include.equipment ? { key: "equipment", label: t("raffle.item_equipment"), total: calculation.categoryTotals.equipmentSaleNeso } : null,
  ].filter(Boolean);

  function categoryQuantity(category) {
    if (category.key === "powerCrystal") return <><strong>{formatNeso(calculation.categoryTotals.powerCrystalAmount)} PC × {powerCrystalNesoRate}</strong><small>{t("raffle.powerCrystalNonTransferable")}</small></>;
    if (category.key === "coin") return <strong>× {formatNeso(calculation.categoryTotals.coinQuantity)}</strong>;
    if (category.key === "equipment") return <EquipmentIcons drops={calculation.equipmentDrops} />;
    return <span className="raffle-empty-value">—</span>;
  }

  function memberCategoryValue(member, key) {
    if (key === "powerCrystal") {
      if (member.powerCrystalAmount === "0") return <span className="raffle-zero-value">0</span>;
      const showConvertedNeso = powerCrystalNesoRate !== "1";
      return <><strong>{formatNeso(member.powerCrystalAmount)} PC</strong>{showConvertedNeso ? <small>{neso(member.powerCrystalNeso)}</small> : null}</>;
    }
    if (key === "coin") {
      if (member.coinQuantity === "0") return <span className="raffle-zero-value">0</span>;
      return <><strong>× {formatNeso(member.coinQuantity)}</strong><small>{neso(member.coinSaleNeso)}</small></>;
    }
    if (key === "equipment") {
      return <><EquipmentIcons drops={member.equipmentDrops} />{member.equipmentDrops.length ? <small>{neso(member.equipmentSaleNeso)}</small> : null}</>;
    }
    if (member[key] === "0") return <span className="raffle-zero-value">0</span>;
    return <strong>{neso(member[key])}</strong>;
  }

  function carryoverBadge(value) {
    const amount = BigInt(value);
    const className = amount > 0n ? "raffle-carryover-receive" : amount < 0n ? "raffle-carryover-pay" : "raffle-carryover-zero";
    return <span className={className}>{signedNeso(value)}</span>;
  }

  function settlementBadgeClassName(member) {
    if (BigInt(member.payment) > 0n) return "raffle-payment";
    if (BigInt(member.receipt) > 0n) return "raffle-receipt";
    return "raffle-settled";
  }

  function settlementBadgeContent(member) {
    if (BigInt(member.payment) > 0n) return <>{t("raffle.pays")}<strong>{neso(member.payment)}</strong></>;
    if (BigInt(member.receipt) > 0n) return <>{t("raffle.receives")}<strong>{neso(member.receipt)}</strong></>;
    return t(calculation.carryoverEnabled && BigInt(member.nextCarryover) !== 0n ? "raffle.noTransferThisWeek" : "raffle.settled");
  }

  return (
    <article className="raffle-settlement-result">
      <h3>{t("raffle.settlementSummary")}</h3>

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
          {calculation.members.map((member) => <article key={member.memberId} className="raffle-member-card">
            <header className="raffle-member-card-header">
              <h4>{memberName(memberMap, member.memberId)}</h4>
              {!member.hasHistory ? <span className="raffle-history-no">{t("raffle.historyNo")}</span> : null}
            </header>
            <p className="raffle-member-card-gross">{t("raffle.grossWon")}: <strong>{neso(member.gross)}</strong></p>
            <div className="raffle-member-card-settle">
              <span className={settlementBadgeClassName(member) + " raffle-badge-lg"}>{settlementBadgeContent(member)}</span>
            </div>
            {calculation.carryoverEnabled ? <p className="raffle-member-card-carryover">{t("raffle.nextCarryover")}: {carryoverBadge(member.nextCarryover)}</p> : null}
          </article>)}
        </div>
      </section>

      <section className="raffle-settlement-section raffle-actual-transfers-section">
        <h4>{t("raffle.actualTransfers")}</h4>
        {calculation.transfers.length ? <ul className="raffle-transfer-list">{calculation.transfers.map((transfer, index) => <li key={transfer.fromMemberId + ":" + transfer.toMemberId + ":" + index} className="raffle-transfer-row">
          <span className="raffle-transfer-payer">{memberName(memberMap, transfer.fromMemberId)}</span>
          <span className="raffle-transfer-arrow" aria-hidden="true">→</span>
          <span className="raffle-transfer-receiver">{memberName(memberMap, transfer.toMemberId)}</span>
          <strong className="raffle-transfer-amount">{neso(transfer.amount)}</strong>
        </li>)}</ul> : <p className="raffle-no-transfers">{t("raffle.noTransfers")}</p>}
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