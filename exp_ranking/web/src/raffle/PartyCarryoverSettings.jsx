import { useTranslation } from "../i18n/I18nContext.jsx";

export default function PartyCarryoverSettings({ party, members, updateParty }) {
  const { t } = useTranslation();

  function setCarryover(assetKey, value) {
    if (!/^[+-]?\d*$/.test(value) || value.length > 31) return;
    updateParty((current) => ({
      ...current,
      carryoverByAssetKey: { ...current.carryoverByAssetKey, [assetKey]: value },
    }));
  }

  return (
    <section className="raffle-carryover-settings">
      <label className="raffle-carryover-toggle">
        <input
          type="checkbox"
          checked={party.carryoverEnabled === true}
          onChange={(event) => updateParty((current) => ({ ...current, carryoverEnabled: event.target.checked }))}
        />
        <span><strong>{t("raffle.carryoverEnabled")}</strong><small>{t("raffle.carryoverHelp")}</small></span>
      </label>
      {party.carryoverEnabled ? <>
        <p className="raffle-carryover-sign-help">{t("raffle.carryoverSignHelp")}</p>
        <div className="raffle-carryover-grid">
          {(members || party.members).map((member) => <label key={member.assetKey} className="raffle-carryover-member">
            <span>{member.displayName}</span>
            <input
              className="raffle-input"
              inputMode="numeric"
              value={party.carryoverByAssetKey?.[member.assetKey] ?? "0"}
              onChange={(event) => setCarryover(member.assetKey, event.target.value)}
              aria-label={member.displayName + " " + t("raffle.previousCarryover")}
            />
          </label>)}
        </div>
      </> : null}
    </section>
  );
}