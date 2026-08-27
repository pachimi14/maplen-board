const DISTRIBUTABLE_BOSSES = new Set(["LUCID", "WILL"]);

export function formatPartyBossName(boss) {
  return boss === "LUCID" ? "Lucid" : boss === "WILL" ? "Will" : "";
}

export function formatPartyClearTitle(clear) {
  const boss = formatPartyBossName(clear?.boss);
  const difficulty = typeof clear?.bossDifficulty === "string"
    ? clear.bossDifficulty.charAt(0) + clear.bossDifficulty.slice(1).toLowerCase()
    : "";
  const tier = typeof clear?.ascendantTier === "string" ? clear.ascendantTier : "";
  return [difficulty, boss].filter(Boolean).join(" ") + (tier ? " + " + tier : "");
}

export function isPartyClearCandidate(clear, memberIds) {
  if (!DISTRIBUTABLE_BOSSES.has(clear?.boss) || !clear?.complete) return false;
  if (!Array.isArray(clear.members) || clear.members.length !== memberIds.length || !Number.isInteger(clear.partyCount) || clear.partyCount < 1 || clear.partyCount > 6) return false;
  if (!Array.isArray(clear.historyMemberIds) || clear.historyMemberIds.length < 1 || clear.historyMemberIds.length > clear.partyCount) return false;
  const roster = new Set(clear.members.map((member) => member.memberId));
  const historyMembers = new Set(clear.historyMemberIds);
  return roster.size === memberIds.length
    && historyMembers.size === clear.historyMemberIds.length
    && memberIds.every((memberId) => roster.has(memberId))
    && clear.historyMemberIds.every((memberId) => roster.has(memberId));
}

export function requiresDistributionConfirmation(clear) {
  const distributionCount = Array.isArray(clear?.members) ? clear.members.length : 0;
  const historyCount = Array.isArray(clear?.historyMemberIds) ? clear.historyMemberIds.length : 0;
  return clear?.partyCount !== distributionCount || historyCount !== distributionCount;
}
export function selectPartyClearCandidates(clears, memberIds) {
  return (Array.isArray(clears) ? clears : []).filter((clear) => isPartyClearCandidate(clear, memberIds));
}

export function groupPartyClearCandidates(clears) {
  return ["LUCID", "WILL"]
    .map((boss) => ({ boss, clears: (Array.isArray(clears) ? clears : []).filter((clear) => clear.boss === boss) }))
    .filter((group) => group.clears.length);
}
export function combineSelectedPartyClears(clears, memberIds) {
  if (!Array.isArray(clears) || clears.length < 1 || !Array.isArray(memberIds) || memberIds.length < 1) return null;
  const boss = clears[0]?.boss;
  if (!DISTRIBUTABLE_BOSSES.has(boss) || clears.some((clear) => clear.boss !== boss || !isPartyClearCandidate(clear, memberIds))) return null;
  const combinedByMember = new Map(memberIds.map((memberId) => [memberId, {
    memberId,
    bossNeso: 0n,
    powerCrystalAmount: 0n,
    ascendantNeso: 0n,
    drops: [],
  }]));
  const historyMemberIds = new Set();
  // S3 (docs/IMPL_PLAN_RAFFLE_REWARD_VOCAB.md): excludedRewards lives on each source clear, not
  // per member -- merged the same way member drops/amounts are, same name summed across every
  // combined clear, so the note shown for a multi-clear selection covers all of them.
  const excludedTotals = new Map();
  for (const clear of clears) {
    clear.historyMemberIds.forEach((memberId) => historyMemberIds.add(memberId));
    for (const member of clear.members) {
      const combined = combinedByMember.get(member.memberId);
      combined.bossNeso += BigInt(member.bossNeso);
      combined.powerCrystalAmount += BigInt(member.powerCrystalAmount);
      combined.ascendantNeso += BigInt(member.ascendantNeso);
      combined.drops.push(...member.drops);
    }
    for (const reward of Array.isArray(clear.excludedRewards) ? clear.excludedRewards : []) {
      excludedTotals.set(reward.name, (excludedTotals.get(reward.name) || 0n) + BigInt(reward.quantity));
    }
  }
  return {
    clearId: "combined-" + clears.map((clear) => clear.clearId).join("+"),
    boss,
    partyCount: Math.max(...clears.map((clear) => clear.partyCount)),
    historyMemberIds: memberIds.filter((memberId) => historyMemberIds.has(memberId)),
    complete: true,
    sourceClears: clears,
    excludedRewards: [...excludedTotals].map(([name, quantity]) => ({ name, quantity: quantity.toString() })),
    members: memberIds.map((memberId) => {
      const member = combinedByMember.get(memberId);
      return {
        memberId,
        bossNeso: member.bossNeso.toString(),
        powerCrystalAmount: member.powerCrystalAmount.toString(),
        ascendantNeso: member.ascendantNeso.toString(),
        drops: member.drops,
      };
    }),
  };
}