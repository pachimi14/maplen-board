const BOSSES = new Set(["LUCID", "WILL", "SLIME"]);
const DROP_CATEGORIES = new Set(["COIN", "EQUIPMENT", "FT_ITEM"]);
const INTEGER_PATTERN = /^\d+$/;
const SIGNED_INTEGER_PATTERN = /^[+-]?\d+$/;
const RATE_PATTERN = /^(\d+)(?:\.(\d{1,18}))?$/;
const MAX_INPUT_DIGITS = 30;
const MAX_RESULT_DIGITS = 60;
const SALE_PROCEEDS_PERCENT = 95n;
const PERCENT_DENOMINATOR = 100n;

function problem(code, field = "", memberId = "", dropId = "") {
  return { code, field, memberId, dropId };
}

function parseInteger(value, field, errors, { memberId = "", dropId = "", required = true } = {}) {
  // G1 (LULU-119 follow-up, user ruling): a blank/whitespace-only/missing
  // value is treated as 0 for non-required fields (currently only sale
  // price) instead of blocking the calculation with invalid_integer. Any
  // other malformed input (non-digits, negative, overflow) still errors --
  // only "left empty" gets the free pass.
  if (!required) {
    const isBlank = value == null || (typeof value === "string" && value.trim() === "");
    if (isBlank) return 0n;
  }
  const text = String(value ?? "");
  if (!INTEGER_PATTERN.test(text)) {
    errors.push(problem("invalid_integer", field, memberId, dropId));
    return 0n;
  }
  const normalized = text.replace(/^0+(?=\d)/, "");
  if (normalized.length > MAX_INPUT_DIGITS) {
    errors.push(problem("input_too_large", field, memberId, dropId));
    return 0n;
  }
  return BigInt(normalized);
}

function parseSignedInteger(value, field, errors, memberId) {
  const text = String(value ?? "").trim();
  if (!SIGNED_INTEGER_PATTERN.test(text)) {
    errors.push(problem("invalid_signed_integer", field, memberId));
    return 0n;
  }
  const negative = text.startsWith("-");
  const signed = negative || text.startsWith("+");
  const digits = (signed ? text.slice(1) : text).replace(/^0+(?=\d)/, "");
  if (digits.length > MAX_INPUT_DIGITS) {
    errors.push(problem("input_too_large", field, memberId));
    return 0n;
  }
  const amount = BigInt(digits);
  return negative ? -amount : amount;
}

export function parseDecimalRate(value) {
  const match = RATE_PATTERN.exec(String(value ?? ""));
  if (!match || match[1].length > MAX_INPUT_DIGITS) return { ok: false, code: "invalid_rate" };
  const fraction = match[2] || "";
  const numerator = BigInt(match[1] + fraction);
  if (numerator === 0n) return { ok: false, code: "invalid_rate" };
  return {
    ok: true,
    numerator,
    denominator: 10n ** BigInt(fraction.length),
  };
}

// Rounds a non-negative BigInt division to the nearest integer, ties rounding
// up (round half up), using only exact integer arithmetic (no Number/float
// division): round(dividend / divisor) == floor((2*dividend + divisor) / (2*divisor)).
function divideRoundHalfUp(dividend, divisor) {
  return (dividend * 2n + divisor) / (2n * divisor);
}

function salePriceToProceeds(salePriceNeso) {
  return (salePriceNeso * SALE_PROCEEDS_PERCENT) / PERCENT_DENOMINATOR;
}

export function calculateSaleProceedsNeso(value) {
  const text = String(value ?? "");
  // G1: blank/whitespace-only mirrors parseInteger's non-required "0"
  // fallback, so the live sale-proceeds preview (RaffleCalculatorRoot.jsx)
  // never shows "?" for a field the calculation will actually treat as 0.
  if (text.trim() === "") return "0";
  if (!INTEGER_PATTERN.test(text)) return null;
  const normalized = text.replace(/^0+(?=\d)/, "");
  if (normalized.length > MAX_INPUT_DIGITS) return null;
  return salePriceToProceeds(BigInt(normalized)).toString();
}

function stringifyChecked(value, errors, field, memberId = "") {
  const text = value.toString();
  if (text.replace("-", "").length > MAX_RESULT_DIGITS) {
    errors.push(problem("result_too_large", field, memberId));
  }
  return text;
}

function buildTransfers(rows) {
  const payers = rows.filter((row) => row.payment > 0n).map((row) => ({ ...row, remaining: row.payment }));
  const receivers = rows.filter((row) => row.receipt > 0n).map((row) => ({ ...row, remaining: row.receipt }));
  const transfers = [];
  let payerIndex = 0;
  let receiverIndex = 0;
  while (payerIndex < payers.length && receiverIndex < receivers.length) {
    const payer = payers[payerIndex];
    const receiver = receivers[receiverIndex];
    const amount = payer.remaining < receiver.remaining ? payer.remaining : receiver.remaining;
    transfers.push({ fromMemberId: payer.memberId, toMemberId: receiver.memberId, amount });
    payer.remaining -= amount;
    receiver.remaining -= amount;
    if (payer.remaining === 0n) payerIndex += 1;
    if (receiver.remaining === 0n) receiverIndex += 1;
  }
  return transfers;
}

function sumBy(rows, field) {
  return rows.reduce((sum, row) => sum + row[field], 0n);
}

export function calculateSettlement(input) {
  const errors = [];
  if (!BOSSES.has(input?.boss)) errors.push(problem("invalid_boss", "boss"));
  if (input?.complete !== true) errors.push(problem("incomplete_clear", "complete"));

  const include = input?.include || {};
  const members = Array.isArray(input?.members) ? input.members : [];
  const partyOrder = Array.isArray(input?.partyOrder) ? input.partyOrder : [];
  const carryoverEnabled = input?.carryoverEnabled === true;
  if (members.length < 1 || members.length > 6 || partyOrder.length !== members.length) {
    errors.push(problem("invalid_member_count", "members"));
  }
  const memberMap = new Map(members.map((member) => [member?.memberId, member]));
  if (memberMap.size !== members.length || partyOrder.some((id) => !memberMap.has(id)) || new Set(partyOrder).size !== partyOrder.length) {
    errors.push(problem("party_mismatch", "partyOrder"));
  }

  const rate = include.powerCrystal ? parseDecimalRate(input?.powerCrystalNesoRate ?? "1") : { ok: true, numerator: 0n, denominator: 1n };
  if (!rate.ok) errors.push(problem(rate.code, "powerCrystalNesoRate"));
  const seenDrops = new Set();
  const historyMemberIds = new Set(Array.isArray(input?.historyMemberIds) ? input.historyMemberIds : []);

  // Extra reward (docs/IMPL_PLAN_RAFFLE_EXTRA_REWARD.md): NESO already
  // received outside the raffle (e.g. a carry's cut sent by other parties)
  // that the party wants folded into this week's distribution. Unlike
  // coin/equipment/FT Item it is not a marketplace sale, so the 5% sale fee
  // never applies here -- each row's amount is added straight into its
  // member's gross/transferableNeso. Same-member rows are summed.
  const extraRewardByMemberId = new Map();
  for (const row of Array.isArray(input?.extraRewards) ? input.extraRewards : []) {
    const rowMemberId = row?.memberId;
    const amount = parseInteger(row?.amountNeso, "extraRewardAmount", errors, { memberId: rowMemberId, required: false });
    if (!memberMap.has(rowMemberId)) {
      errors.push(problem("invalid_extra_reward_member", "extraRewardMember", rowMemberId));
      continue;
    }
    extraRewardByMemberId.set(rowMemberId, (extraRewardByMemberId.get(rowMemberId) || 0n) + amount);
  }

  const rows = partyOrder.map((memberId) => {
    const member = memberMap.get(memberId) || {};
    const bossNeso = include.bossNeso
      ? parseInteger(member.bossNeso, "bossNeso", errors, { memberId })
      : 0n;
    const ascendantNeso = include.ascendantNeso
      ? parseInteger(member.ascendantNeso, "ascendantNeso", errors, { memberId })
      : 0n;
    const powerCrystalAmount = include.powerCrystal
      ? parseInteger(member.powerCrystalAmount, "powerCrystalAmount", errors, { memberId })
      : 0n;
    let powerCrystalNeso = 0n;
    if (include.powerCrystal && rate.ok) {
      // NESO conversion is a division ("1 NESO = [rate] Power Crystal"):
      // powerCrystalNeso = powerCrystalAmount / rate, rounded half up using
      // exact BigInt arithmetic (powerCrystalAmount * rate.denominator / rate.numerator).
      powerCrystalNeso = divideRoundHalfUp(powerCrystalAmount * rate.denominator, rate.numerator);
    }

    let coinQuantity = 0n;
    let coinSaleNeso = 0n;
    let equipmentQuantity = 0n;
    let equipmentSaleNeso = 0n;
    let ftItemQuantity = 0n;
    let ftItemSaleNeso = 0n;
    const equipmentDrops = [];
    for (const drop of Array.isArray(member.drops) ? member.drops : []) {
      if (!drop?.dropId || seenDrops.has(drop.dropId) || !DROP_CATEGORIES.has(drop.category)) {
        errors.push(problem("invalid_drop", "drops", memberId, drop?.dropId || ""));
        continue;
      }
      seenDrops.add(drop.dropId);
      const selected = drop.category === "COIN" ? include.coin : drop.category === "FT_ITEM" ? include.ftItem : include.equipment;
      if (!selected) continue;
      const quantity = parseInteger(drop.quantity, "dropQuantity", errors, { memberId, dropId: drop.dropId });
      // G1 (LULU-119 follow-up, user ruling): an unfilled sale price is
      // treated as 0 NESO (not a blocking invalid_integer error) -- the old
      // "empty = can't calculate / 0 = explicitly worthless" distinction is
      // retired. A genuinely malformed value (letters, negative, overflow)
      // still errors.
      const salePriceNeso = parseInteger(input?.saleNesoByDropId?.[drop.dropId], "saleNeso", errors, {
        memberId,
        dropId: drop.dropId,
        required: false,
      });
      // FT Item is a marketplace-sellable item just like coin/equipment: same
      // 5% sale-proceeds deduction applies (LULU-090 rule).
      const saleNeso = salePriceToProceeds(salePriceNeso);
      if (drop.category === "COIN") {
        coinQuantity += quantity;
        coinSaleNeso += saleNeso;
      } else if (drop.category === "FT_ITEM") {
        ftItemQuantity += quantity;
        ftItemSaleNeso += saleNeso;
      } else {
        equipmentQuantity += quantity;
        equipmentSaleNeso += saleNeso;
        equipmentDrops.push({
          dropId: drop.dropId,
          name: typeof drop.name === "string" ? drop.name : "",
          quantity: quantity.toString(),
          imageUrl: typeof drop.imageUrl === "string" ? drop.imageUrl : "",
          salePriceNeso: salePriceNeso.toString(),
          saleNeso: saleNeso.toString(),
        });
      }
    }
    const previousCarryover = carryoverEnabled
      ? parseSignedInteger(input?.previousCarryoverByMemberId?.[memberId] ?? "0", "previousCarryover", errors, memberId)
      : 0n;
    const extraReward = extraRewardByMemberId.get(memberId) || 0n;
    // Extra reward is already-received NESO (not a marketplace sale), so it
    // skips the 5% sale fee and goes straight into transferableNeso.
    const transferableNeso = bossNeso + ascendantNeso + coinSaleNeso + equipmentSaleNeso + ftItemSaleNeso + extraReward;
    return {
      memberId,
      hasHistory: historyMemberIds.has(memberId),
      bossNeso,
      powerCrystalAmount,
      powerCrystalNeso,
      ascendantNeso,
      coinQuantity,
      coinSaleNeso,
      equipmentQuantity,
      equipmentSaleNeso,
      equipmentDrops,
      ftItemQuantity,
      ftItemSaleNeso,
      extraReward,
      previousCarryover,
      transferableNeso,
      gross: transferableNeso + powerCrystalNeso,
    };
  });

  if (carryoverEnabled && sumBy(rows, "previousCarryover") !== 0n) {
    errors.push(problem("carryover_not_balanced", "previousCarryover"));
  }
  if (errors.length) return { ok: false, errors };

  const total = sumBy(rows, "gross");
  const count = BigInt(rows.length);
  const baseShare = total / count;
  const remainder = Number(total % count);
  const calculated = rows.map((row, index) => {
    const assignedShare = baseShare + (index < remainder ? 1n : 0n);
    const balance = row.gross - assignedShare - row.previousCarryover;
    const amountDue = balance > 0n ? balance : 0n;
    const amountOwed = balance < 0n ? -balance : 0n;
    const payment = carryoverEnabled && amountDue > row.transferableNeso ? row.transferableNeso : amountDue;
    return { ...row, assignedShare, balance, payment, receipt: amountOwed };
  });
  const transfers = buildTransfers(calculated);
  const paidByMember = new Map(partyOrder.map((memberId) => [memberId, 0n]));
  const receivedByMember = new Map(partyOrder.map((memberId) => [memberId, 0n]));
  for (const transfer of transfers) {
    paidByMember.set(transfer.fromMemberId, paidByMember.get(transfer.fromMemberId) + transfer.amount);
    receivedByMember.set(transfer.toMemberId, receivedByMember.get(transfer.toMemberId) + transfer.amount);
  }

  const finalized = calculated.map((row) => {
    const actualPayment = paidByMember.get(row.memberId);
    const actualReceipt = receivedByMember.get(row.memberId);
    let nextCarryover = 0n;
    if (carryoverEnabled && row.balance > 0n) nextCarryover = -(row.balance - actualPayment);
    if (carryoverEnabled && row.balance < 0n) nextCarryover = -row.balance - actualReceipt;
    return { ...row, payment: actualPayment, receipt: actualReceipt, nextCarryover };
  });

  const outputErrors = [];
  const resultMembers = finalized.map((row) => ({
    memberId: row.memberId,
    hasHistory: row.hasHistory,
    bossNeso: stringifyChecked(row.bossNeso, outputErrors, "bossNeso", row.memberId),
    powerCrystalAmount: stringifyChecked(row.powerCrystalAmount, outputErrors, "powerCrystalAmount", row.memberId),
    powerCrystalNeso: stringifyChecked(row.powerCrystalNeso, outputErrors, "powerCrystalNeso", row.memberId),
    ascendantNeso: stringifyChecked(row.ascendantNeso, outputErrors, "ascendantNeso", row.memberId),
    coinQuantity: stringifyChecked(row.coinQuantity, outputErrors, "coinQuantity", row.memberId),
    coinSaleNeso: stringifyChecked(row.coinSaleNeso, outputErrors, "coinSaleNeso", row.memberId),
    equipmentQuantity: stringifyChecked(row.equipmentQuantity, outputErrors, "equipmentQuantity", row.memberId),
    equipmentSaleNeso: stringifyChecked(row.equipmentSaleNeso, outputErrors, "equipmentSaleNeso", row.memberId),
    equipmentDrops: row.equipmentDrops,
    ftItemQuantity: stringifyChecked(row.ftItemQuantity, outputErrors, "ftItemQuantity", row.memberId),
    ftItemSaleNeso: stringifyChecked(row.ftItemSaleNeso, outputErrors, "ftItemSaleNeso", row.memberId),
    extraReward: stringifyChecked(row.extraReward, outputErrors, "extraReward", row.memberId),
    transferableNeso: stringifyChecked(row.transferableNeso, outputErrors, "transferableNeso", row.memberId),
    previousCarryover: stringifyChecked(row.previousCarryover, outputErrors, "previousCarryover", row.memberId),
    gross: stringifyChecked(row.gross, outputErrors, "gross", row.memberId),
    assignedShare: stringifyChecked(row.assignedShare, outputErrors, "assignedShare", row.memberId),
    balance: stringifyChecked(row.balance, outputErrors, "balance", row.memberId),
    payment: stringifyChecked(row.payment, outputErrors, "payment", row.memberId),
    receipt: stringifyChecked(row.receipt, outputErrors, "receipt", row.memberId),
    nextCarryover: stringifyChecked(row.nextCarryover, outputErrors, "nextCarryover", row.memberId),
  }));
  const resultTransfers = transfers.map((transfer) => ({
    fromMemberId: transfer.fromMemberId,
    toMemberId: transfer.toMemberId,
    amount: stringifyChecked(transfer.amount, outputErrors, "transfer"),
  }));
  const categoryTotals = {
    bossNeso: stringifyChecked(sumBy(rows, "bossNeso"), outputErrors, "categoryBossNeso"),
    powerCrystalAmount: stringifyChecked(sumBy(rows, "powerCrystalAmount"), outputErrors, "categoryPowerCrystalAmount"),
    powerCrystalNeso: stringifyChecked(sumBy(rows, "powerCrystalNeso"), outputErrors, "categoryPowerCrystalNeso"),
    ascendantNeso: stringifyChecked(sumBy(rows, "ascendantNeso"), outputErrors, "categoryAscendantNeso"),
    coinQuantity: stringifyChecked(sumBy(rows, "coinQuantity"), outputErrors, "categoryCoinQuantity"),
    coinSaleNeso: stringifyChecked(sumBy(rows, "coinSaleNeso"), outputErrors, "categoryCoinSaleNeso"),
    equipmentQuantity: stringifyChecked(sumBy(rows, "equipmentQuantity"), outputErrors, "categoryEquipmentQuantity"),
    equipmentSaleNeso: stringifyChecked(sumBy(rows, "equipmentSaleNeso"), outputErrors, "categoryEquipmentSaleNeso"),
    ftItemQuantity: stringifyChecked(sumBy(rows, "ftItemQuantity"), outputErrors, "categoryFtItemQuantity"),
    ftItemSaleNeso: stringifyChecked(sumBy(rows, "ftItemSaleNeso"), outputErrors, "categoryFtItemSaleNeso"),
    extraReward: stringifyChecked(sumBy(rows, "extraReward"), outputErrors, "categoryExtraReward"),
    transferableNeso: stringifyChecked(sumBy(rows, "transferableNeso"), outputErrors, "categoryTransferableNeso"),
  };
  const equipmentDrops = finalized.flatMap((row) => row.equipmentDrops.map((drop) => ({ ...drop, memberId: row.memberId })));
  const totalText = stringifyChecked(total, outputErrors, "total");
  const baseShareText = stringifyChecked(baseShare, outputErrors, "baseShare");
  if (outputErrors.length) return { ok: false, errors: outputErrors };
  return {
    ok: true,
    boss: input.boss,
    total: totalText,
    memberCount: rows.length,
    baseShare: baseShareText,
    remainder,
    carryoverEnabled,
    categoryTotals,
    equipmentDrops,
    members: resultMembers,
    transfers: resultTransfers,
  };
}
