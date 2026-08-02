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
      return <><strong>{formatNeso(member.powerCrystalAmount)} PC</strong><small>{neso(member.powerCrystalNeso)} · {t("raffle.powerCrystalNonTransferable")}</small></>;
    }
    if (key === "coin") {
      return <><strong>× {formatNeso(member.coinQuantity)}</strong><small>{neso(member.coinSaleNeso)}</small></>;
    }
    if (key === "equipment") {
      return <><EquipmentIcons drops={member.equipmentDrops} /><small>{neso(member.equipmentSaleNeso)}</small></>;
    }
    return <strong>{neso(member[key])}</strong>;
  }

  function carryoverBadge(value) {
    const amount = BigInt(value);
    const className = amount > 0n ? "raffle-carryover-receive" : amount < 0n ? "raffle-carryover-pay" : "raffle-carryover-zero";
    return <span className={className}>{signedNeso(value)}</span>;
  }

  return (
    <article className="raffle-settlement-result">
      <h3>{t("raffle.settlementSummary")}</h3>
      <div className="raffle-settlement-metrics">
        <div><span>{t("raffle.total")}</span><strong>{neso(calculation.total)}</strong></div>
        <div><span>{t("raffle.transferableNeso")}</span><strong>{neso(calculation.categoryTotals.transferableNeso)}</strong></div>
        <div><span>{t("raffle.distributionMembers")}</span><strong>{calculation.memberCount}</strong></div>
        <div><span>{t("raffle.baseShare")}</span><strong>{neso(calculation.baseShare)}</strong></div>
        <div><span>{t("raffle.remainder")}</span><strong>{neso(calculation.remainder)}</strong></div>
      </div>
      <p className="raffle-settlement-formula">{t("raffle.settlementFormula")}</p>

      <section className="raffle-settlement-section">
        <h4>{t("raffle.categoryBreakdown")}</h4>
        <div className="raffle-table-scroll">
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
      </section>

      <section className="raffle-settlement-section">
        <h4>{t("raffle.memberBreakdown")}</h4>
        <div className="raffle-table-scroll">
          <table className="raffle-settlement-table raffle-member-table">
            <thead><tr>
              <th>{t("raffle.member")}</th>
              <th>{t("raffle.raffleHistory")}</th>
              {calculation.carryoverEnabled ? <th>{t("raffle.previousCarryover")}</th> : null}
              {categoryColumns.map((category) => <th key={category.key}>{category.label}</th>)}
              <th>{t("raffle.grossWon")}</th>
              <th>{t("raffle.assignedShare")}</th>
              <th>{t("raffle.settlement")}</th>
              {calculation.carryoverEnabled ? <th>{t("raffle.nextCarryover")}</th> : null}
            </tr></thead>
            <tbody>{calculation.members.map((member) => {
              const payment = BigInt(member.payment);
              const receipt = BigInt(member.receipt);
              return <tr key={member.memberId}>
                <th scope="row">{memberName(memberMap, member.memberId)}</th>
                <td><span className={member.hasHistory ? "raffle-history-yes" : "raffle-history-no"}>{t(member.hasHistory ? "raffle.historyYes" : "raffle.historyNo")}</span></td>
                {calculation.carryoverEnabled ? <td>{carryoverBadge(member.previousCarryover)}</td> : null}
                {categoryColumns.map((category) => <td key={category.key} className="raffle-member-amount">{memberCategoryValue(member, category.key)}</td>)}
                <td className="raffle-strong-amount">{neso(member.gross)}</td>
                <td className="raffle-strong-amount">{neso(member.assignedShare)}</td>
                <td>{payment > 0n
                  ? <span className="raffle-payment">{t("raffle.pays")}<strong>{neso(member.payment)}</strong></span>
                  : receipt > 0n
                    ? <span className="raffle-receipt">{t("raffle.receives")}<strong>{neso(member.receipt)}</strong></span>
                    : <span className="raffle-settled">{t(calculation.carryoverEnabled && BigInt(member.nextCarryover) !== 0n ? "raffle.noTransferThisWeek" : "raffle.settled")}</span>}</td>
                {calculation.carryoverEnabled ? <td>{carryoverBadge(member.nextCarryover)}</td> : null}
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      <section className="raffle-settlement-section">
        <h4>{t("raffle.actualTransfers")}</h4>
        {calculation.transfers.length ? <div className="raffle-table-scroll"><table className="raffle-settlement-table raffle-transfer-table">
          <thead><tr><th>{t("raffle.payer")}</th><th>{t("raffle.receiver")}</th><th>{t("raffle.amount")}</th></tr></thead>
          <tbody>{calculation.transfers.map((transfer, index) => <tr key={transfer.fromMemberId + ":" + transfer.toMemberId + ":" + index}>
            <td>{memberName(memberMap, transfer.fromMemberId)}</td>
            <td>{memberName(memberMap, transfer.toMemberId)}</td>
            <td>{neso(transfer.amount)}</td>
          </tr>)}</tbody>
        </table></div> : <p className="raffle-no-transfers">{t("raffle.noTransfers")}</p>}
      </section>
    </article>
  );
}