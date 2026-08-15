import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useTranslation } from "../../../i18n/I18nContext.jsx";
import { flattenDiscoveryCandidates, matchesDiscoveryQuery } from "../domain/search.js";

/** plan §5(g)/(g-1): a small search box over the (currently 3) monitored
 * groups, matching any of their 15 alias names/ids -- same shape as
 * ../../components/EquipmentSelector.jsx (its own header comment explains
 * the representative-vs-alias distinction) but a fresh, isolated
 * implementation (see domain/search.js's own header) so nothing here can
 * regress the existing #/starforce screen. */
export default function DiscoveryEquipmentSelector({ items, selectedItemId, selectedItemName, onSelect }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const allCandidates = useMemo(() => flattenDiscoveryCandidates(items), [items]);
  const candidates = useMemo(
    () => allCandidates.filter((candidate) => matchesDiscoveryQuery(candidate, query)).slice(0, 30),
    [allCandidates, query],
  );

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
          candidates.length > 0 ? (
            <ul className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-xl divide-y divide-slate-800">
              {candidates.map((candidate) => (
                <li key={candidate.key}>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onSelect(candidate);
                      setQuery("");
                      setOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 text-sm hover:bg-slate-800 ${
                      candidate.itemId === selectedItemId ? "bg-slate-800/80 text-sky-200" : "text-slate-200"
                    }`}
                  >
                    <span className="font-semibold">{candidate.itemName}</span>
                  </button>
                </li>
              ))}
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
