import { useEffect, useMemo, useRef, useState } from "react";

export default function CharacterPickerDialog({ open, loading, characters, registeredKeys, onClose, onRegister, onRetry, t }) {
  const dialogRef = useRef(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog.open) {
      setQuery("");
      setMessage("");
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (needle.length < 2) return [];
    return characters
      .filter((character) => character.name.toLocaleLowerCase().includes(needle))
      .slice(0, 20);
  }, [characters, query]);

  function register(historyKey) {
    const result = onRegister(historyKey);
    if (result.ok) {
      setMessage(t("characters.registered"));
      setQuery("");
    } else {
      setMessage(t(`characters.${result.code}`));
    }
  }

  return (
    <dialog ref={dialogRef} onClose={onClose} className="dialog-card backdrop:bg-slate-900/35">
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold text-slate-900">{t("characters.add")}</h2>
          <button type="button" onClick={onClose} className="mini-button">{t("actions.close")}</button>
        </div>
        <input
          autoFocus
          className="field"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("characters.searchPlaceholder")}
        />
        {loading ? <p className="py-6 text-center text-sm text-slate-500">{t("characters.loading")}</p> : null}
        {!loading && characters.length === 0 ? (
          <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
            <p>{t("characters.loadFailed")}</p>
            <button type="button" onClick={onRetry} className="mt-3 mini-button">{t("actions.retry")}</button>
          </div>
        ) : null}
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {results.map((character) => {
            const registered = registeredKeys.includes(character.historyKey);
            return (
              <div key={character.historyKey} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                {character.imageUrl ? <img src={character.imageUrl} alt="" className="h-12 w-12 rounded-xl bg-slate-100 object-contain" /> : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{character.name}</p>
                  <p className="text-xs text-slate-500">{character.job} · {character.worldId} · Lv.{character.level}</p>
                </div>
                <button type="button" disabled={registered} onClick={() => register(character.historyKey)} className="mini-button disabled:opacity-40">
                  {registered ? t("characters.alreadyRegistered") : t("characters.register")}
                </button>
              </div>
            );
          })}
        </div>
        {!loading && query.trim().length >= 2 && results.length === 0 && characters.length > 0 ? (
          <p className="text-center text-sm text-slate-500">{t("characters.notFound")}</p>
        ) : null}
        {message ? <p role="status" className="text-sm text-emerald-700">{message}</p> : null}
      </div>
    </dialog>
  );
}
