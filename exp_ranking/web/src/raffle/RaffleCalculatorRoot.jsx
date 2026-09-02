import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../i18n/I18nContext.jsx";
import { parseNavigatorCharacterUrl } from "./domain/assetInput.js";
import { mergeSearchCandidates, searchRankingCharacters } from "./domain/rankingSearch.js";
import { isDisplayableWorldId } from "./domain/worldDisplay.js";
import { currentRaffleRoundUtc } from "./domain/raffleRound.js";
import { combineSelectedPartyClears, formatPartyBossName, formatPartyClearTitle, groupPartyClearCandidates, requiresDistributionConfirmation, selectPartyClearCandidates } from "./domain/partyClears.js";
import { sortPartyMembers } from "./domain/partyOrder.js";
import { calculateSaleProceedsNeso, calculateSettlement } from "./domain/settlement.js";
import { RAFFLE_SCHEMA_VERSION } from "./domain/contract.js";
import { raffleSource } from "./integrations/raffleSource.js";
import { RaffleResultList, RaffleResultSummary } from "./RaffleResultCard.jsx";
import PartyCarryoverSettings from "./PartyCarryoverSettings.jsx";
import SettlementResult from "./SettlementResult.jsx";
import { MAX_MEMBERS, createEmptyRaffleState, createParty, loadRaffleState, saveRaffleState } from "./storage/raffleStorage.js";
import { describeProgressStage, describeRaffleCode, describeRaffleEntry, describeSettlementError, formatRaffleRoundLocal, formatRaffleRoundUtc, scrollElementIntoView } from "./uiText.js";
import "./raffle.css";

const ITEM_KEYS = ["coin", "equipment", "bossNeso", "powerCrystal", "ascendantNeso"];

function initialModel() {
  const loaded = loadRaffleState();
  return { state: loaded.state || createEmptyRaffleState(), storageCode: loaded.ok ? "" : loaded.code };
}

function initialBossSetting() {
  return {
    include: { coin: true, equipment: true, ftItem: true, bossNeso: true, powerCrystal: true, ascendantNeso: true },
    powerCrystalNesoRate: "1.1",
    saleNesoByDropId: {},
    // docs/IMPL_PLAN_RAFFLE_EXTRA_REWARD.md: rows of { rowId, memberId,
    // amountNeso }, added via the "+ extra reward" button. Starts empty (0
    // rows) so a party that never uses it sees no change at all -- not
    // persisted (same as the rest of this per-boss distribution setting).
    extraRewards: [],
    calculated: null,
  };
}

function initialDistributionSettings() {
  return { LUCID: initialBossSetting(), WILL: initialBossSetting(), SLIME: initialBossSetting() };
}

function formatNesoPreview(value, locale) {
  if (value == null) return "?";
  try {
    return BigInt(value).toLocaleString(locale) + " NESO";
  } catch {
    return "?";
  }
}

// S3 (docs/IMPL_PLAN_RAFFLE_MULTI_CLEAR.md): same boss/difficulty/partyCount candidates are
// otherwise indistinguishable in the UI, so the clear time (when the server resolved one) is
// shown alongside the label. Falls back to no text at all when clearedAt is empty/invalid --
// this never blocks selecting or confirming a candidate.
function clearedAtLabel(clear, t, language) {
  const local = formatRaffleRoundLocal(clear?.clearedAt, { locale: language });
  return local ? t("raffle.clearedAtLabel", { time: local }) : "";
}

export default function RaffleCalculatorRoot({ rankingCharacters = [], rankingLoading = false, rankingLoadError = "" } = {}) {
  const { t, language } = useTranslation();
  const initial = useMemo(initialModel, []);
  const [model, setModel] = useState(initial.state);
  const [storageCode, setStorageCode] = useState(initial.storageCode);
  const [dirty, setDirty] = useState(false);
  const [characterQuery, setCharacterQuery] = useState("");
  const [characterResults, setCharacterResults] = useState([]);
  const [searchCompleted, setSearchCompleted] = useState(false);
  const [searching, setSearching] = useState(false);
  // S2: true once an official-API character search has failed (network
  // error, rate limit, invalid response, ...) -- gates the "ranking
  // candidates still work" announcement, independent of the generic
  // requestError banner (which stays focused on the raw error code).
  const [apiSearchFailed, setApiSearchFailed] = useState(false);
  const [navigatorUrl, setNavigatorUrl] = useState("");
  const [resolving, setResolving] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [jobResult, setJobResult] = useState(null);
  const [requestError, setRequestError] = useState("");
  const [resultTab, setResultTab] = useState("raffles");
  const [selectedResultMemberId, setSelectedResultMemberId] = useState("");
  const [activeClearBoss, setActiveClearBoss] = useState("");
  const [selectedClearIdsByBoss, setSelectedClearIdsByBoss] = useState({ LUCID: [], WILL: [], SLIME: [] });
  const [confirmedClearIds, setConfirmedClearIds] = useState([]);
  const [distribution, setDistribution] = useState(initialDistributionSettings);
  const resultsSectionRef = useRef(null);
  const settlementRef = useRef(null);

  const activeParty = model.parties.find((party) => party.id === model.activePartyId) || model.parties[0] || null;
  const sortedActiveMembers = activeParty ? sortPartyMembers(activeParty.members) : [];
  // S1: ranking-first predictive candidates -- recomputed locally from the
  // already-fetched ranking board as the user types (zero network calls).
  const rankingCandidates = useMemo(
    () => searchRankingCharacters(rankingCharacters, characterQuery, { limit: 10 }),
    [rankingCharacters, characterQuery],
  );
  // S2: once the official-API search button has returned results, they are
  // merged into the same list (API-origin wins on a duplicate assetKey and
  // is shown first) instead of being a second, separate list.
  const combinedCandidates = useMemo(
    () => (characterResults.length ? mergeSearchCandidates(rankingCandidates, characterResults) : rankingCandidates),
    [rankingCandidates, characterResults],
  );
  const targetRound = currentRaffleRoundUtc();
  const targetRoundLocalText = formatRaffleRoundLocal(targetRound, { locale: language });
  const targetRoundUtcText = formatRaffleRoundUtc(targetRound);

  useEffect(() => {
    if (!dirty) return;
    const saved = saveRaffleState(model);
    if (!saved.ok) setStorageCode(saved.code);
  }, [dirty, model]);

  useEffect(() => {
    if (jobResult) scrollElementIntoView(resultsSectionRef.current);
  }, [jobResult]);

  function updateModel(updater) {
    setDirty(true);
    setStorageCode("");
    setModel((current) => (typeof updater === "function" ? updater(current) : updater));
  }

  function updateParty(updater) {
    if (!activeParty) return;
    updateModel((current) => ({ ...current, parties: current.parties.map((party) => party.id === activeParty.id ? updater(party) : party) }));
  }

  function updatePartySettlementSettings(updater) {
    updateParty(updater);
    setDistribution((current) => ({
      LUCID: { ...current.LUCID, calculated: null },
      WILL: { ...current.WILL, calculated: null },
      SLIME: { ...current.SLIME, calculated: null },
    }));
  }

  function addParty() {
    if (model.parties.length >= 10) return;
    const id = "party-" + Date.now().toString(36);
    updateModel((current) => ({ ...current, activePartyId: id, parties: [...current.parties, createParty(id, t("raffle.defaultPartyName"))] }));
    setJobResult(null);
  }

  function addMember(candidate) {
    if (!activeParty || !candidate?.assetKey || activeParty.members.length >= MAX_MEMBERS) return;
    if (activeParty.members.some((member) => member.assetKey === candidate.assetKey)) return;
    // S3'/LULU-116: no world-match guard here (removed -- it was an
    // unrecorded gate that never fed the API request, boss-clear matching,
    // or settlement calculation; worldId is display-only). Ranking-origin
    // (world name) and API-origin (numeric world id) members can freely mix
    // in the same party.
    updateParty((party) => ({ ...party, members: [...party.members, { assetKey: candidate.assetKey, displayName: candidate.displayName || candidate.name || candidate.assetKey, worldId: candidate.worldId || "", level: candidate.level ?? null, jobName: candidate.jobName || "", imageUrl: candidate.imageUrl || "" }] }));
    setJobResult(null);
    setRequestError("");
  }

  async function searchCharacter() {
    const query = characterQuery.trim();
    if (query.length < 2) {
      setRequestError(t("raffle.invalidCharacterName"));
      return;
    }
    setSearching(true);
    setSearchCompleted(false);
    setRequestError("");
    setApiSearchFailed(false);
    setCharacterResults([]);
    const searched = await raffleSource.searchCharacters(query);
    setSearching(false);
    setSearchCompleted(true);
    if (!searched.ok || searched.data?.schemaVersion !== RAFFLE_SCHEMA_VERSION || !Array.isArray(searched.data?.results)) {
      setRequestError(describeRaffleCode(searched.code || "invalidResponse", { t }));
      // S2: the official API is unreachable/failing, but ranking candidates
      // (above) still work and are not blocked by this failure -- surface
      // that explicitly instead of leaving the user to guess.
      setApiSearchFailed(true);
      return;
    }
    const results = searched.data.results.filter((candidate) =>
      /^CHAR[A-Za-z0-9_-]{4,124}$/.test(candidate?.assetKey || "")
      && typeof candidate?.displayName === "string"
      && candidate.displayName,
    );
    setCharacterResults(results);
  }

  function addSearchResult(candidate) {
    addMember(candidate);
    setCharacterResults([]);
    setSearchCompleted(false);
    setApiSearchFailed(false);
    setCharacterQuery("");
  }

  async function addNavigatorMember() {
    const parsed = parseNavigatorCharacterUrl(navigatorUrl);
    if (!parsed.ok) { setRequestError(t("raffle.invalidNavigatorUrl")); return; }
    setResolving(true);
    setRequestError("");
    const memberId = "resolve-" + Date.now().toString(36);
    const resolved = await raffleSource.resolveCharacter({ memberId, assetKey: parsed.assetKey });
    setResolving(false);
    if (!resolved.ok || resolved.data?.memberId !== memberId) {
      setRequestError(describeRaffleCode(resolved.code || "invalidResponse", { t }));
      return;
    }
    addMember({ assetKey: parsed.assetKey, ...resolved.data });
    setNavigatorUrl("");
  }

  function removeMember(assetKey) {
    updateParty((party) => {
      const carryoverByAssetKey = { ...party.carryoverByAssetKey };
      delete carryoverByAssetKey[assetKey];
      return { ...party, members: party.members.filter((member) => member.assetKey !== assetKey), carryoverByAssetKey };
    });
    setJobResult(null);
  }

  async function loadPartyHistory() {
    if (!activeParty?.members.length) { setRequestError(t("raffle.missingParty")); return; }
    setRunning(true);
    setRequestError("");
    setJobResult(null);
    setDistribution(initialDistributionSettings());
    setSelectedClearIdsByBoss({ LUCID: [], WILL: [], SLIME: [] });
    setConfirmedClearIds([]);
    const memberMap = {};
    const characters = sortPartyMembers(activeParty.members).map((member, index) => {
      const memberId = "member-" + String(index + 1);
      memberMap[memberId] = member;
      return { memberId, assetKey: member.assetKey };
    });
    setProgress({ stage: "queued", completedCharacters: 0, totalCharacters: characters.length, elapsedMs: 0 });
    const result = await raffleSource.runJob({ raffledAt: targetRound, characters }, { onProgress: setProgress });
    setRunning(false);
    if (!result.ok) { setRequestError(describeRaffleCode(result.code, { t })); return; }
    const memberIds = characters.map((character) => character.memberId);
    const clears = selectPartyClearCandidates(result.data.clears, memberIds);
    const clearGroups = groupPartyClearCandidates(clears);
    const initialSelections = { LUCID: [], WILL: [], SLIME: [] };
    clearGroups.forEach((group) => {
      if (group.clears.length === 1) initialSelections[group.boss] = [group.clears[0].clearId];
    });
    setJobResult({ ...result.data, clears, memberMap, round: targetRound, partyOrder: memberIds });
    setSelectedResultMemberId(memberIds[0] || "");
    setSelectedClearIdsByBoss(initialSelections);
    setActiveClearBoss(clearGroups.find((group) => initialSelections[group.boss].length)?.boss || clearGroups[0]?.boss || "");
    setResultTab("raffles");
  }

  function updateBossSetting(boss, updater) {
    setDistribution((current) => ({ ...current, [boss]: { ...updater(current[boss]), calculated: null } }));
  }

  // docs/IMPL_PLAN_RAFFLE_EXTRA_REWARD.md: "+ extra reward" adds one row
  // (defaults to the first party member so the row is immediately valid --
  // the user still has to pick the intended member and amount).
  function addExtraRewardRow(boss) {
    const rowId = "extra-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    const defaultMemberId = jobResult?.partyOrder?.[0] || "";
    updateBossSetting(boss, (setting) => ({ ...setting, extraRewards: [...setting.extraRewards, { rowId, memberId: defaultMemberId, amountNeso: "" }] }));
  }

  function updateExtraRewardRow(boss, rowId, patch) {
    updateBossSetting(boss, (setting) => ({ ...setting, extraRewards: setting.extraRewards.map((row) => row.rowId === rowId ? { ...row, ...patch } : row) }));
  }

  function removeExtraRewardRow(boss, rowId) {
    updateBossSetting(boss, (setting) => ({ ...setting, extraRewards: setting.extraRewards.filter((row) => row.rowId !== rowId) }));
  }

  function calculateBoss(clear) {
    const sourceClears = Array.isArray(clear?.sourceClears) ? clear.sourceClears : [clear];
    if (sourceClears.some((source) => requiresDistributionConfirmation(source) && !confirmedClearIds.includes(source.clearId))) return;
    const setting = distribution[clear.boss];
    const previousCarryoverByMemberId = Object.fromEntries(jobResult.partyOrder.map((memberId) => {
      const assetKey = jobResult.memberMap[memberId]?.assetKey || "";
      return [memberId, activeParty?.carryoverByAssetKey?.[assetKey] ?? "0"];
    }));
    const calculated = calculateSettlement({
      ...clear,
      partyOrder: jobResult.partyOrder,
      include: setting.include,
      powerCrystalNesoRate: setting.powerCrystalNesoRate,
      saleNesoByDropId: setting.saleNesoByDropId,
      extraRewards: setting.extraRewards,
      carryoverEnabled: activeParty?.carryoverEnabled === true,
      previousCarryoverByMemberId,
    });
    setDistribution((current) => ({ ...current, [clear.boss]: { ...current[clear.boss], calculated } }));
  }

  function toggleDistributionConfirmation(clearId) {
    setConfirmedClearIds((current) => current.includes(clearId)
      ? current.filter((value) => value !== clearId)
      : [...current, clearId]);
    setDistribution((current) => ({
      LUCID: { ...current.LUCID, calculated: null },
      WILL: { ...current.WILL, calculated: null },
      SLIME: { ...current.SLIME, calculated: null },
    }));
  }
  function toggleClearSelection(clear) {
    setSelectedClearIdsByBoss((current) => {
      const selected = current[clear.boss] || [];
      const next = selected.includes(clear.clearId)
        ? selected.filter((clearId) => clearId !== clear.clearId)
        : [...selected, clear.clearId];
      return { ...current, [clear.boss]: next };
    });
    setActiveClearBoss(clear.boss);
    setDistribution((current) => ({ ...current, [clear.boss]: { ...current[clear.boss], calculated: null } }));
  }

  const selectedResults = jobResult
    ? jobResult.raffleResults.filter((result) => result.memberId === selectedResultMemberId && result.rewards.some((reward) => reward.won))
    : [];
  const clearGroups = groupPartyClearCandidates(jobResult?.clears || []);
  const selectedClears = activeClearBoss && jobResult
    ? jobResult.clears.filter((clear) => clear.boss === activeClearBoss && selectedClearIdsByBoss[activeClearBoss]?.includes(clear.clearId))
    : [];
  const activeClear = jobResult ? combineSelectedPartyClears(selectedClears, jobResult.partyOrder) : null;
  const activeSetting = activeClear ? distribution[activeClear.boss] : null;
  const confirmationRequiredClears = activeClear
    ? activeClear.sourceClears.filter((clear) => requiresDistributionConfirmation(clear))
    : [];
  const distributionRosterConfirmed = confirmationRequiredClears.every((clear) => confirmedClearIds.includes(clear.clearId));
  const dropNameByDropId = activeClear
    ? Object.fromEntries(activeClear.members.flatMap((member) => member.drops.map((drop) => [drop.dropId, drop.name])))
    : {};
  // F2/LULU-119: the Will FT Item checkbox (Sealed Mirror World Nodestone) only
  // shows up when a Will clear is active and at least one member actually won
  // it this week -- Lucid never rolls this item and an empty checkbox with no
  // possible drops would just be noise.
  const hasFtItemDrop = activeClear?.boss === "WILL"
    && activeClear.members.some((member) => member.drops.some((drop) => drop.category === "FT_ITEM"));
  // G1/LULU-119 follow-up: sale-price inputs for every currently-included
  // sellable drop (coin/equipment/FT Item) -- computed once so the fail-
  // visible "blank = 0" note (below) and the input list itself never
  // disagree about which drops actually have an input rendered.
  const saleableDrops = activeClear && activeSetting
    ? activeClear.members.flatMap((member) => member.drops.map((drop) => ({ member, drop })))
      .filter(({ drop }) => drop.category === "COIN" ? activeSetting.include.coin : drop.category === "FT_ITEM" ? activeSetting.include.ftItem : activeSetting.include.equipment)
    : [];
  const activeClearBossLabel = activeClear
    ? [...new Set(activeClear.sourceClears.map((clear) => formatPartyClearTitle(clear)))].join(", ")
    : "";
  // S3 (docs/IMPL_PLAN_RAFFLE_REWARD_VOCAB.md): informational only (not an alert -- Sealed
  // Nodestone shows up most weeks, so alerting on it would just be noise) note listing every
  // reward this clear won that fell out of every distributable category, so a future
  // classification gap is visible in the UI instead of silently vanishing.
  const excludedRewardsText = activeClear?.excludedRewards?.length
    ? activeClear.excludedRewards.map((reward) => reward.name + " ×" + reward.quantity).join(", ")
    : "";

  useEffect(() => {
    if (activeSetting?.calculated?.ok) scrollElementIntoView(settlementRef.current);
  }, [activeSetting?.calculated]);

  return (
    <main className="raffle-root mx-auto w-full max-w-[112rem] px-3 py-5 sm:px-5 lg:px-7 xl:px-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-600">Lulumi Tools</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950 dark:text-white">Raffle Calculator</h1>
        <p className="mt-2 max-w-5xl text-sm text-slate-600 dark:text-slate-300">{t("raffle.subtitle")}</p>
      </div>
      {storageCode ? <div role="alert" className="mb-4 rounded-xl border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">{t("raffle.storageError")} ({storageCode})</div> : null}
      {requestError ? <div role="alert" className="mb-4 rounded-xl border border-rose-400 bg-rose-50 p-3 text-sm text-rose-900">{requestError}</div> : null}

      <div className="raffle-workspace">
        <section className="raffle-setup-grid">
          <div className="raffle-card raffle-party-card">
            <div className="flex flex-wrap items-center justify-between gap-3"><h2>{"1. " + t("raffle.party")}</h2><button type="button" className="raffle-button-secondary" onClick={addParty}>{t("raffle.newParty")}</button></div>
            {model.parties.length ? <select className="raffle-input mt-3" value={activeParty?.id || ""} onChange={(event) => { updateModel((current) => ({ ...current, activePartyId: event.target.value })); setJobResult(null); }}>{model.parties.map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}</select> : <p className="mt-3 text-sm text-slate-500">{t("raffle.noParty")}</p>}
            {activeParty ? <>
              <label className="raffle-label mt-4">{t("raffle.partyName")}<input className="raffle-input mt-1" maxLength={80} value={activeParty.name} onChange={(event) => updateParty((party) => ({ ...party, name: event.target.value }))} /></label>
              <label className="raffle-label mt-4">{t("raffle.characterName")}<div className="mt-1 grid gap-2 sm:grid-cols-[1fr_auto]"><input className="raffle-input" value={characterQuery} onChange={(event) => setCharacterQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") searchCharacter(); }} placeholder={t("raffle.characterNamePlaceholder")} /><button type="button" className="raffle-button-secondary" disabled={searching} onClick={searchCharacter}>{searching ? t("raffle.searching") : t("raffle.search")}</button></div></label>
              {apiSearchFailed ? <p role="status" className="mt-3 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-700 dark:bg-sky-950/30">{t("raffle.apiUnavailableAnnouncement")}</p> : null}
              {characterQuery.trim() ? combinedCandidates.length ? <div className="mt-3 space-y-2">{combinedCandidates.map((candidate) => <article key={candidate.assetKey} className="flex items-center justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30"><div className="flex min-w-0 items-center gap-3">{candidate.imageUrl ? <img className="h-12 w-12 rounded-lg object-cover" src={candidate.imageUrl} alt="" /> : null}<div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate font-semibold">{candidate.displayName}</p><span className="shrink-0 rounded-full border border-emerald-400 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:border-emerald-600 dark:text-emerald-300">{candidate.source === "ranking" ? t("raffle.rankingCandidateBadge") : t("raffle.apiCandidateBadge")}</span></div><p className="truncate text-xs text-slate-500">{candidate.level != null ? "Lv." + candidate.level : ""}{candidate.jobName ? " · " + candidate.jobName : ""}{isDisplayableWorldId(candidate.worldId) ? " · " + candidate.worldId : ""}</p></div></div><button type="button" className="raffle-button-primary shrink-0" onClick={() => addSearchResult(candidate)}>{t("raffle.addToParty")}</button></article>)}</div> : rankingLoading ? <p className="mt-3 text-sm text-slate-500">{t("raffle.rankingCandidatesLoading")}</p> : rankingLoadError ? <p className="mt-3 text-sm text-slate-500">{t("raffle.rankingCandidatesUnavailable")}</p> : searchCompleted ? <p className="mt-3 text-sm text-slate-500">{t("raffle.noCharacterFound")}</p> : null : null}
              <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700"><label className="raffle-label">{t("raffle.navigatorUrl")}<div className="mt-1 grid gap-2 sm:grid-cols-[1fr_auto]"><input className="raffle-input" value={navigatorUrl} onChange={(event) => setNavigatorUrl(event.target.value)} placeholder="https://msu.io/navigator/character/CHAR..." /><button type="button" className="raffle-button-secondary" disabled={resolving} onClick={addNavigatorMember}>{resolving ? t("raffle.loading") : t("raffle.add")}</button></div></label></div>
              <ul className="raffle-party-members mt-4">{sortedActiveMembers.map((member) => <li key={member.assetKey} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"><div className="flex min-w-0 items-center gap-3">{member.imageUrl ? <img className="h-10 w-10 rounded-lg object-cover" src={member.imageUrl} alt="" /> : null}<div className="min-w-0"><p className="truncate font-semibold">{member.displayName}</p><p className="truncate text-xs text-slate-500">{member.level != null ? "Lv." + member.level : ""}{member.jobName ? " · " + member.jobName : ""}{isDisplayableWorldId(member.worldId) ? " · " + member.worldId : ""}</p></div></div><button type="button" className="raffle-button-remove" onClick={() => removeMember(member.assetKey)}>{t("raffle.remove")}</button></li>)}</ul>
              <PartyCarryoverSettings party={activeParty} members={sortedActiveMembers} updateParty={updatePartySettlementSettings} />
            </> : null}
          </div>

          <div className="raffle-setup-side">
          <div className="raffle-card">
            <h2>{"2. " + t("raffle.weeklyHistory")}</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t("raffle.targetRound")}: <strong>{t("raffle.targetRoundValue", { local: targetRoundLocalText, utc: targetRoundUtcText })}</strong></p>
            <button type="button" className="raffle-button-primary mt-4 w-full" disabled={running} onClick={loadPartyHistory}>{running ? t("raffle.loading") : t("raffle.loadPartyHistory")}</button>
            <div className="mt-4" aria-live="polite">
              {progress ? <>
                <div className="raffle-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.totalCharacters > 0 ? Math.round((progress.completedCharacters / progress.totalCharacters) * 100) : 0}>
                  <div className="raffle-progress-bar-fill" style={{ width: (progress.totalCharacters > 0 ? Math.round((progress.completedCharacters / progress.totalCharacters) * 100) : 0) + "%" }} />
                </div>
                <p className="raffle-progress-text mt-2">{describeProgressStage(progress, { t })}</p>
              </> : <p className="text-sm text-slate-500">{t("raffle.notStarted")}</p>}
            </div>
          </div>
          </div>
        </section>

        <section ref={resultsSectionRef}>
          <div className="raffle-card raffle-results-card">
            <h2>{"3. " + t("raffle.results")}</h2>
            {!jobResult ? <p className="mt-3 text-sm text-slate-500">{t("raffle.noResults")}</p> : <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-2" role="tablist" aria-label={t("raffle.results")}>
                <button type="button" role="tab" aria-selected={resultTab === "raffles"} className={resultTab === "raffles" ? "raffle-boss-active" : "raffle-boss"} onClick={() => setResultTab("raffles")}><span className="block">Raffle Results</span><span className="raffle-tab-sublabel">{t("raffle.tabRafflesSub")}</span></button>
                <button type="button" role="tab" aria-selected={resultTab === "clears"} className={resultTab === "clears" ? "raffle-boss-active" : "raffle-boss"} onClick={() => setResultTab("clears")}><span className="block">Party Clears</span><span className="raffle-tab-sublabel">{t("raffle.tabClearsSub")}</span></button>
              </div>
              {jobResult.warnings.length ? <div role="status" className="space-y-1 rounded-xl border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">{jobResult.warnings.map((entry, index) => <p key={index}>{describeRaffleEntry(entry, { t, memberMap: jobResult.memberMap })}</p>)}</div> : null}
              {jobResult.errors.length ? <div role="alert" className="space-y-1 rounded-xl border border-rose-400 bg-rose-50 p-3 text-sm text-rose-900">{jobResult.errors.map((entry, index) => <p key={index}>{describeRaffleEntry(entry, { t, memberMap: jobResult.memberMap })}</p>)}</div> : null}

              {resultTab === "raffles" ? <div className="space-y-3">
                <label className="raffle-label">{t("raffle.resultCharacter")}<select className="raffle-input mt-1" value={selectedResultMemberId} onChange={(event) => setSelectedResultMemberId(event.target.value)}>{jobResult.partyOrder.map((memberId) => <option key={memberId} value={memberId}>{jobResult.memberMap[memberId]?.displayName || memberId}</option>)}</select></label>
                {selectedResults.length ? <><RaffleResultSummary key={selectedResultMemberId} results={selectedResults} /><RaffleResultList results={selectedResults} /></> : <p className="text-sm text-slate-500">{t("raffle.noRaffleResults")}</p>}
              </div> : <div className="space-y-4">
                {jobResult.clears.length ? <>
                  {clearGroups.map((group) => group.clears.length > 1 ? <fieldset key={group.boss} className="rounded-xl border border-amber-400 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/20">
                    <legend className="px-1 font-bold">{formatPartyBossName(group.boss)} · {t("raffle.selectDistributionCandidates")}</legend>
                    <p className="mb-3 text-sm text-amber-900 dark:text-amber-100">{t("raffle.multipleDifficultyHelp")}</p>
                    <div className="space-y-2">{group.clears.map((clear) => <label key={clear.clearId} className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-300 bg-white p-3 dark:border-amber-800 dark:bg-slate-950">
                      <input type="checkbox" className="mt-1" checked={selectedClearIdsByBoss[group.boss]?.includes(clear.clearId) || false} onChange={() => toggleClearSelection(clear)} />
                      <span><strong className="block">{formatPartyClearTitle(clear)}</strong><span className="text-xs text-slate-500">{t("raffle.participantCounts", { partyCount: clear.partyCount, historyCount: clear.historyMemberIds.length, distributionCount: clear.members.length })}</span>{clearedAtLabel(clear, t, language) ? <span className="block text-xs text-slate-500">{clearedAtLabel(clear, t, language)}</span> : null}</span>
                    </label>)}</div>
                  </fieldset> : null)}
                  {clearGroups.some((group) => selectedClearIdsByBoss[group.boss]?.length) ? <div className="grid grid-cols-2 gap-2">{clearGroups.filter((group) => selectedClearIdsByBoss[group.boss]?.length).map((group) => {
                    const selected = group.clears.filter((clear) => selectedClearIdsByBoss[group.boss].includes(clear.clearId));
                    const label = selected.length === 1 ? formatPartyClearTitle(selected[0]) : formatPartyBossName(group.boss) + " · " + t("raffle.selectedCandidateCount", { count: selected.length });
                    return <button key={group.boss} type="button" className={activeClearBoss === group.boss ? "raffle-boss-active" : "raffle-boss"} onClick={() => setActiveClearBoss(group.boss)}>{label}</button>;
                  })}</div> : <p className="text-sm text-slate-500">{t("raffle.chooseAtLeastOneCandidate")}</p>}
                  {activeClear && activeSetting ? <div className="space-y-4">
                    <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/20">
                      <h3 className="font-semibold">{formatPartyBossName(activeClear.boss)} · {t("raffle.distributionItems")}</h3>
                      <p className="mt-1 text-sm">{t("raffle.distributionRoster", { memberCount: activeClear.members.length })}</p>
                      <ul className="mt-2 space-y-1 text-sm">{activeClear.sourceClears.map((clear) => <li key={clear.clearId}><strong>{formatPartyClearTitle(clear)}</strong> · {t("raffle.participantCounts", { partyCount: clear.partyCount, historyCount: clear.historyMemberIds.length, distributionCount: clear.members.length })}{clearedAtLabel(clear, t, language) ? " · " + clearedAtLabel(clear, t, language) : ""}</li>)}</ul>
                    </div>
                    {confirmationRequiredClears.length ? <fieldset className="rounded-xl border border-amber-400 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/20">
                      <legend className="px-1 font-bold">{t("raffle.distributionConfirmation")}</legend>
                      <p className="mb-3 text-sm text-amber-900 dark:text-amber-100">{t("raffle.distributionConfirmationHelp")}</p>
                      <div className="space-y-2">{confirmationRequiredClears.map((clear) => <label key={clear.clearId} className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-300 bg-white p-3 dark:border-amber-800 dark:bg-slate-950">
                        <input type="checkbox" className="mt-1" checked={confirmedClearIds.includes(clear.clearId)} onChange={() => toggleDistributionConfirmation(clear.clearId)} />
                        <span><strong className="block">{formatPartyClearTitle(clear)}</strong><span className="text-xs text-slate-600 dark:text-slate-300">{t("raffle.participantCounts", { partyCount: clear.partyCount, historyCount: clear.historyMemberIds.length, distributionCount: clear.members.length })}</span>{clearedAtLabel(clear, t, language) ? <span className="block text-xs text-slate-600 dark:text-slate-300">{clearedAtLabel(clear, t, language)}</span> : null}<span className="mt-1 block text-sm font-semibold">{t("raffle.confirmDistributionRoster", { distributionCount: clear.members.length })}</span></span>
                      </label>)}</div>
                    </fieldset> : null}
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      {ITEM_KEYS.map((key) => <label key={key} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-700"><input type="checkbox" checked={activeSetting.include[key]} onChange={(event) => updateBossSetting(activeClear.boss, (setting) => ({ ...setting, include: { ...setting.include, [key]: event.target.checked } }))} />{t("raffle.item_" + key)}</label>)}
                      {hasFtItemDrop ? <label key="ftItem" className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-700"><input type="checkbox" checked={activeSetting.include.ftItem} onChange={(event) => updateBossSetting(activeClear.boss, (setting) => ({ ...setting, include: { ...setting.include, ftItem: event.target.checked } }))} />{t("raffle.item_ftItem")}</label> : null}
                    </div>
                    {excludedRewardsText ? <p className="raffle-hint-text">{t("raffle.excludedRewardsNote", { list: excludedRewardsText })}</p> : null}
                    {activeSetting.include.powerCrystal ? <label className="raffle-label max-w-xl">{t("raffle.powerCrystalRate")}<div className="raffle-rate-inline mt-1"><span>{t("raffle.powerCrystalRatePrefix")}</span><input className="raffle-input raffle-rate-input" inputMode="decimal" value={activeSetting.powerCrystalNesoRate} onChange={(event) => updateBossSetting(activeClear.boss, (setting) => ({ ...setting, powerCrystalNesoRate: event.target.value }))} /><span>{t("raffle.powerCrystalRateSuffix")}</span></div><span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">{t("raffle.powerCrystalRateHelp")}</span></label> : null}
                    {saleableDrops.length ? <p className="raffle-hint-text">{t("raffle.saleAmountBlankIsZero")}</p> : null}
                    {saleableDrops.map(({ member, drop }) => {
                      const salePrice = activeSetting.saleNesoByDropId[drop.dropId] || "";
                      const saleProceeds = calculateSaleProceedsNeso(salePrice);
                      return <label key={drop.dropId} className="raffle-label">{(jobResult.memberMap[member.memberId]?.displayName || member.memberId) + " — " + drop.name + " × " + drop.quantity}
                        <span className="mt-1 block text-xs font-normal text-slate-500">{t("raffle.saleAmount")}</span>
                        <input className="raffle-input mt-1" inputMode="numeric" value={salePrice} onChange={(event) => updateBossSetting(activeClear.boss, (setting) => ({ ...setting, saleNesoByDropId: { ...setting.saleNesoByDropId, [drop.dropId]: event.target.value } }))} placeholder="0" />
                        <span className="raffle-sale-proceeds">
                          <span>{t("raffle.saleProceeds")}</span>
                          <strong>{formatNesoPreview(saleProceeds, language)}</strong>
                        </span>
                      </label>;
                    })}
                    <div className="raffle-extra-reward-section">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h4 className="font-semibold">{t("raffle.item_extraReward")}</h4>
                        <button type="button" className="raffle-button-secondary" onClick={() => addExtraRewardRow(activeClear.boss)}>{t("raffle.addExtraReward")}</button>
                      </div>
                      <p className="raffle-hint-text">{t("raffle.extraRewardHelp")}</p>
                      {activeSetting.extraRewards.map((row) => <div key={row.rowId} className="raffle-extra-reward-row mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                        <select className="raffle-input" value={row.memberId} onChange={(event) => updateExtraRewardRow(activeClear.boss, row.rowId, { memberId: event.target.value })}>
                          {jobResult.partyOrder.map((memberId) => <option key={memberId} value={memberId}>{jobResult.memberMap[memberId]?.displayName || memberId}</option>)}
                        </select>
                        <label className="raffle-label">
                          <span className="mt-1 block text-xs font-normal text-slate-500">{t("raffle.extraRewardAmountLabel")}</span>
                          <input className="raffle-input mt-1" inputMode="numeric" value={row.amountNeso} placeholder="0" onChange={(event) => updateExtraRewardRow(activeClear.boss, row.rowId, { amountNeso: event.target.value })} />
                        </label>
                        <button type="button" className="raffle-button-remove" onClick={() => removeExtraRewardRow(activeClear.boss, row.rowId)}>{t("raffle.remove")}</button>
                      </div>)}
                    </div>
                    <button type="button" className="raffle-button-primary w-full" disabled={!distributionRosterConfirmed} onClick={() => calculateBoss(activeClear)}>{t("raffle.calculateDistribution")}</button>
                    {!distributionRosterConfirmed ? <p className="raffle-hint-text">{t("raffle.confirmBeforeCalculate")}</p> : null}
                    <div ref={settlementRef}>
                      {activeSetting.calculated ? activeSetting.calculated.ok ? <SettlementResult calculation={activeSetting.calculated} include={activeSetting.include} memberMap={jobResult.memberMap} memberWallets={jobResult.memberWallets} powerCrystalNesoRate={activeSetting.powerCrystalNesoRate} bossLabel={activeClearBossLabel} roundLocalText={targetRoundLocalText} roundUtcText={targetRoundUtcText} /> : <div role="alert" className="space-y-1 rounded-xl border border-rose-400 bg-rose-50 p-3 text-sm text-rose-900">{activeSetting.calculated.errors.map((error, index) => <p key={index}>{describeSettlementError(error, { t, memberMap: jobResult.memberMap, dropNameByDropId })}</p>)}</div> : null}
                    </div>
                  </div> : null}
                </> : <p className="text-sm text-slate-500">{t("raffle.noPartyClears")}</p>}
              </div>}
            </div>}
          </div>
        </section>
      </div>
    </main>
  );
}
