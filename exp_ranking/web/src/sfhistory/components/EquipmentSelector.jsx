import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useTranslation } from "../../i18n/I18nContext.jsx";

// IMPL_PLAN_SH9 §3-3: search/select candidates are the flattened per-alias
// rows (one per itemId in a group, design §7 -- "検索対象はグループ内の全
// itemId"), each carrying both its own itemId/itemName *and* the group's
// representative -- so a player wearing an alias piece (e.g. an AbsoLab
// Knight Gloves wearer, the "AbsoLab Mage Gloves" group's representative
// being a different piece) can find and select their own item by name, while
// `onSelect` still resolves to the representative for `prices`/`latest`
// (design §7: "取得・表示は代表"). Falls back to a single self-named row
// when an item has no `aliases` at all (a pre-SH9 `/sf-history/equipment`
// response -- sfHistorySource.js's own normalizer already guarantees at
// least that one row, so this is defense in depth, not the primary path).
function flattenCandidates(items) {
  const rows = [];
  for (const item of items) {
    const aliases = item.aliases?.length ? item.aliases : [{ itemId: item.itemId, itemName: item.itemName }];
    for (const alias of aliases) {
      rows.push({
        key: `${item.itemId}-${alias.itemId}`,
        representativeItemId: item.itemId,
        representativeItemName: item.itemName,
        itemId: alias.itemId,
        itemName: alias.itemName,
        maxStar: item.maxStar,
      });
    }
  }
  return rows;
}

function matchesEquipmentQuery(candidate, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  if (candidate.itemName.toLowerCase().includes(normalized)) return true;
  return String(candidate.itemId).includes(normalized);
}

/**
 * `selectedItemId` / `selectedItemName` (IMPL_PLAN_SH9 §3-3): the specific
 * alias row the user actually picked (or the representative itself, if they
 * picked that / haven't picked an alias) -- *not* necessarily the
 * representative's own id/name. This is what makes the closed-input text and
 * the highlighted dropdown row reflect "AbsoLab Knight Gloves" rather than
 * silently renaming the user's selection to "AbsoLab Mage Gloves" the moment
 * they pick it. `onSelect` receives the full candidate object (both ids).
 */
export default function EquipmentSelector({ items, selectedItemId, selectedItemName, onSelect }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const allCandidates = useMemo(() => flattenCandidates(items), [items]);

  const candidates = useMemo(
    () => allCandidates.filter((candidate) => matchesEquipmentQuery(candidate, query)).slice(0, 30),
    [allCandidates, query],
  );

  return (
    <div className="sfh-select-group">
      <span className="sfh-field-label">{t("sfhistory.equipment.label")}</span>
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
            placeholder={t("sfhistory.equipment.searchPlaceholder")}
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
                    <span className="text-slate-500 ml-2">
                      #{candidate.itemId} · {t("sfhistory.equipment.maxStarBadge", { maxStar: candidate.maxStar })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-500 shadow-xl">
              {t("sfhistory.equipment.noMatch")}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
