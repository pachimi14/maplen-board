import { useEffect, useState } from "react";

function parseHash(hash) {
  const raw = (hash || "").replace(/^#/, "");
  const path = raw === "" ? "/" : raw;
  if (path === "/") {
    return { name: "list" };
  }
  const match = path.match(/^\/character\/([^/]+)$/);
  if (match) {
    return { name: "detail", historyKey: decodeURIComponent(match[1]) };
  }
  return { name: "list" };
}

/**
 * Subscribes to `window.location.hash` and returns the current parsed route.
 * Routes:
 *   - `#/` or empty  -> { name: "list" }
 *   - `#/character/:historyKey` -> { name: "detail", historyKey }
 *   - anything else  -> falls back to `{ name: "list" }` (no crash)
 */
export function useHashRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));

  useEffect(() => {
    function handleHashChange() {
      setRoute(parseHash(window.location.hash));
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return route;
}

export function navigateToList() {
  window.location.hash = "#/";
}

export function navigateToCharacter(historyKey) {
  window.location.hash = `#/character/${encodeURIComponent(historyKey)}`;
}
