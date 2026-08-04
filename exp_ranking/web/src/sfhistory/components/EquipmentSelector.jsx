import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useTranslation } from "../../i18n/I18nContext.jsx";

// IMPL_PLAN_SH5 §2: search target is every itemId (representative + all
// aliasItemIds, design §7 -- "検索対象はグループ内の全 itemId") and the
// display name, so a player wearing an alias piece (e.g. AbsoLab Warrior
// Gloves) can still find the shared representative series. Same combobox
// shape as CharacterSearchPicker.jsx (text input + filtered dropdown, no
// new UI library).
function matchesEquipmentQuery(item, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  if (item.itemName.toLowerCase().includes(normalized)) return true;
  if (String(item.itemId).includes(normalized)) return true;
  return item.aliasItemIds.some((id) => String(id).includes(normalized));
}

export default function EquipmentSelector({ items, selectedItemId, onSelect }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const selectedItem = items.find((item) => item.itemId === selectedItemId) ?? null;

  const candidates = useMemo(
    () => items.filter((item) => matchesEquipmentQuery(item, query)).slice(0, 30),
    [items, query],
  );

  return (
    <div className="sfh-select-group">
      <span className="sfh-field-label">{t("sfhistory.equipment.label")}</span>
      <div className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 text-slate-500 pointer-events-none" size={16} />
          <Input
            value={open ? query : (selectedItem?.itemName ?? "")}
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
              {candidates.map((item) => (
                <li key={item.itemId}>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onSelect(item.itemId);
                      setQuery("");
                      setOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 text-sm hover:bg-slate-800 ${
                      item.itemId === selectedItemId ? "bg-slate-800/80 text-sky-200" : "text-slate-200"
                    }`}
                  >
                    <span className="font-semibold">{item.itemName}</span>
                    <span className="text-slate-500 ml-2">
                      #{item.itemId} · {t("sfhistory.equipment.maxStarBadge", { maxStar: item.maxStar })}
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
