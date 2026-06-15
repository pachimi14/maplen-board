import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useTranslation } from "./i18n/I18nContext";
import { formatJobName } from "./rankingUtils";

function matchesCharacterQuery(character, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    character.name.toLowerCase().includes(normalized) ||
    formatJobName(character.job).toLowerCase().includes(normalized) ||
    (character.worldId || "").toLowerCase().includes(normalized)
  );
}

export default function CharacterSearchPicker({ characters, selectedId, onSelect }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const candidates = useMemo(() => {
    if (!query.trim()) {
      return [];
    }
    return characters.filter((character) => matchesCharacterQuery(character, query)).slice(0, 20);
  }, [characters, query]);

  const showDropdown = open && query.trim().length > 0;

  const handleSelect = (character) => {
    onSelect(character.id);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 text-slate-500 pointer-events-none" size={18} />
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 150);
          }}
          placeholder={t("characterDetail.switchCharacter")}
          className="pl-10 bg-slate-950 border-slate-700 text-slate-100"
        />
      </div>
      {showDropdown ? (
        candidates.length > 0 ? (
          <ul className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-xl divide-y divide-slate-800">
            {candidates.map((character) => (
              <li key={character.id}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSelect(character)}
                  className={`w-full text-left px-3 py-2.5 text-sm hover:bg-slate-800 ${
                    character.id === selectedId ? "bg-slate-800/80 text-sky-200" : "text-slate-200"
                  }`}
                >
                  <span className="font-semibold">{character.name}</span>
                  <span className="text-slate-500 ml-2">
                    {formatJobName(character.job)}
                    {character.worldId ? ` · ${character.worldId}` : ""}
                    {` · Lv.${character.level} #${character.rank}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-500 shadow-xl">
            {t("characterDetail.switchCharacterNoMatch")}
          </div>
        )
      ) : null}
    </div>
  );
}
