import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useTranslation } from "../../../i18n/I18nContext.jsx";
import { groupDiscoveryCandidates } from "../domain/search.js";

/** plan §5(g)/(g-1) + SH-33 §4 (B): a small search box over the (currently
 * 3) monitored GROUPS -- one row per group, not one per alias -- matching
 * any of their 15 alias names/ids (`groupDiscoveryCandidates` in
 * `../domain/search.js`, unchanged match rule from before this plan, only
 * the display folding is new). Same shape as
 * ../../components/EquipmentSelector.jsx (its own header comment explains
 * the representative-vs-alias distinction) but a fresh, isolated
 * implementation so nothing here can regress the existing #/starforce
 * screen.
 *
 * Clicking the bold representative name selects that alias; clicking one of
 * the small job-variant badges below it selects THAT specific alias instead
 * (plan §4: "黙って別名を出さない" -- the user always picks the exact name
 * they see, never a silently-substituted one). The badge that actually
 * matched the current query is highlighted, and its full name is echoed
 * below the badge row (plan §4: "一致したalias名を候補内で示す") so a
 * result whose representative name differs from what was typed is never a
 * mystery. */
export default function DiscoveryEquipmentSelector({ items, selectedItemId, selectedItemName, onSelect }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const groups = useMemo(() => groupDiscoveryCandidates(items, query).slice(0, 30), [items, query]);

  function selectAlias(group, alias) {
    onSelect({ representativeItemId: group.representativeItemId, itemId: alias.itemId, itemName: alias.itemName });
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="sfh-select-group">
      <span className="sfh-field-label">{t("sfhistoryDiscovery.equipment.label")}</span>
      <div className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 text-slate-500 pointer-events-none" size={16} />
          <Input
            value={open ? query : (selectedItemName ?? "")}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              setQuery("");
              setOpen(true);
            }}
            onBlur={() => {
              window.setTimeout(() => setOpen(false), 150);
            }}
            placeholder={t("sfhistoryDiscovery.equipment.searchPlaceholder")}
            className="pl-9 bg-slate-950 border-slate-700 text-slate-100 w-full min-w-[16rem]"
          />
        </div>
        {open ? (
          groups.length > 0 ? (
            <ul className="absolute z-20 mt-1 w-full max-h-80 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-xl divide-y divide-slate-800">
              {groups.map((group) => {
                const matchedNames = group.aliases.filter((alias) => alias.matched).map((alias) => alias.itemName);
                const showMatchNote = query.trim() !== "" && matchedNames.length > 0
                  && !(matchedNames.length === 1 && matchedNames[0] === group.representativeItemName);
                return (
                  <li key={group.key} className="px-3 py-2.5">
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectAlias(group, { itemId: group.representativeItemId, itemName: group.representativeItemName })}
                      className={`block w-full text-left text-sm font-semibold hover:underline ${
                        group.representativeItemId === selectedItemId ? "text-sky-200" : "text-slate-200"
                      }`}
                    >
                      {group.representativeItemName}
                    </button>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {group.aliases.map((alias) => (
                        <button
                          key={alias.itemId}
                          type="button"
                          title={alias.itemName}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectAlias(group, alias)}
                          className={`rounded-full px-2 py-0.5 text-xs transition ${
                            alias.itemId === selectedItemId
                              ? "bg-sky-500/25 text-sky-200 font-semibold"
                              : alias.matched
                                ? "bg-sky-500/15 text-sky-300"
                                : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                          }`}
                        >
                          {alias.label}
                        </button>
                      ))}
                    </div>
                    {showMatchNote ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {t("sfhistoryDiscovery.equipment.matchedAliases", { names: matchedNames.join(", ") })}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-500 shadow-xl">
              {t("sfhistoryDiscovery.equipment.noMatch")}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
