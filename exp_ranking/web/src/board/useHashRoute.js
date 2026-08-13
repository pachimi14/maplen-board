import { useEffect, useState } from "react";
import { WORLD_IDS } from "../rankingUtils";
import { JOB_TAXONOMY } from "../jobCategories";

/**
 * URL query data contract (IMPL_PLAN_T2 §3). `QUERY_PARAM_ORDER` is the
 * fixed serialization order: the same board state always produces the
 * same URL. Values equal to their default are omitted from the URL.
 */
const QUERY_DEFAULTS = {
  sort: "daily",
  world: "all",
  alliance: "all",
  branch: "all",
  job: "all",
  minLevel: "225",
  gainPeriod: "daily",
  minGain: "",
  q: "",
  page: "1",
};

const QUERY_PARAM_ORDER = Object.keys(QUERY_DEFAULTS);

const SORT_KEYS = ["rank", "daily", "weekly", "monthly"];
const GAIN_PERIODS = ["daily", "weekly", "monthly"];

function findAlliance(alliance) {
  return JOB_TAXONOMY.find((entry) => entry.alliance === alliance) ?? null;
}

function isValidBranch(alliance, branch) {
  const entry = findAlliance(alliance);
  if (!entry) {
    return false;
  }
  return entry.branches.some((candidate) => candidate.branch === branch);
}

function isValidJob(alliance, branch, job) {
  const entry = findAlliance(alliance);
  if (!entry) {
    return false;
  }
  if (alliance === "冒険家" && branch !== "all") {
    const branchEntry = entry.branches.find((candidate) => candidate.branch === branch);
    return branchEntry ? branchEntry.jobs.includes(job) : false;
  }
  return entry.branches.some((candidate) => candidate.jobs.includes(job));
}

function normalizeMinLevel(raw) {
  if (raw === undefined || raw === null || raw === "") {
    return QUERY_DEFAULTS.minLevel;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 225 ? String(parsed) : QUERY_DEFAULTS.minLevel;
}

function normalizeMinGain(raw) {
  if (raw === undefined || raw === null || raw === "") {
    return QUERY_DEFAULTS.minGain;
  }
  const parsed = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(parsed) ? String(raw) : QUERY_DEFAULTS.minGain;
}

function normalizePage(raw) {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? String(parsed) : QUERY_DEFAULTS.page;
}

/**
 * Validates and defaults a raw (possibly malformed / partially-missing)
 * query object into a fully-defaulted, internally-consistent query
 * (IMPL_PLAN_T2 §6 normalization + §7 alliance/branch/job cascade). Never
 * throws: any unrecognized/invalid value falls back to its default.
 */
export function normalizeQuery(raw = {}) {
  const query = { ...QUERY_DEFAULTS };

  query.sort = SORT_KEYS.includes(raw.sort) ? raw.sort : QUERY_DEFAULTS.sort;
  query.world = raw.world === "all" || WORLD_IDS.includes(raw.world) ? raw.world : "all";

  query.alliance = raw.alliance === "all" || findAlliance(raw.alliance)
    ? raw.alliance
    : "all";

  query.branch = query.alliance !== "all"
    && raw.branch
    && raw.branch !== "all"
    && isValidBranch(query.alliance, raw.branch)
    ? raw.branch
    : "all";

  query.job = query.alliance !== "all"
    && raw.job
    && raw.job !== "all"
    && isValidJob(query.alliance, query.branch, raw.job)
    ? raw.job
    : "all";

  query.minLevel = normalizeMinLevel(raw.minLevel);
  query.gainPeriod = GAIN_PERIODS.includes(raw.gainPeriod) ? raw.gainPeriod : QUERY_DEFAULTS.gainPeriod;
  query.minGain = normalizeMinGain(raw.minGain);
  query.q = typeof raw.q === "string" ? raw.q : QUERY_DEFAULTS.q;
  query.page = normalizePage(raw.page);

  return query;
}

/** Serializes a (already-normalized) query to `URLSearchParams`, in the
 * fixed §3 order, omitting params equal to their default (short URL). */
export function serializeQuery(query) {
  const params = new URLSearchParams();
  for (const key of QUERY_PARAM_ORDER) {
    const value = query?.[key];
    if (value !== undefined && value !== null && String(value) !== String(QUERY_DEFAULTS[key])) {
      params.set(key, value);
    }
  }
  return params;
}

function splitHash(hash) {
  const raw = (hash || "").replace(/^#/, "");
  const queryIndex = raw.indexOf("?");
  const path = queryIndex === -1 ? raw : raw.slice(0, queryIndex);
  const search = queryIndex === -1 ? "" : raw.slice(queryIndex + 1);
  return { path: path === "" ? "/" : path, search };
}

function parseRawQuery(search) {
  let params;
  try {
    params = new URLSearchParams(search);
  } catch {
    params = new URLSearchParams();
  }
  const raw = {};
  for (const key of QUERY_PARAM_ORDER) {
    const value = params.get(key);
    if (value !== null) {
      raw[key] = value;
    }
  }
  return raw;
}

/**
 * Parses `window.location.hash` into a fully-normalized route. Routes:
 *   - `#/` or empty (+ optional query)               -> { name: "list", query }
 *   - `#/character/:historyKey` (+ optional query)    -> { name: "detail", historyKey, query }
 *   - `#/group` (+ optional query)                    -> { name: "group", query }
 *   - `#/dashboard`                                   -> { name: "dashboard", query }
 *   - `#/tasks`                                       -> { name: "tasks", query }
 *   - `#/schedule`                                    -> { name: "schedule", query }
 *     (T4b §22.4: group has no groupId of its own — the active group is
 *     decision C, resolved from existing activeGroupId/localStorage, never
 *     the URL)
 *   - anything else                                   -> falls back to list (no crash)
 */
export function parseHash(hash) {
  const { path, search } = splitHash(hash);
  const query = normalizeQuery(parseRawQuery(search));

  const match = path.match(/^\/character\/([^/]+)$/);
  if (match) {
    let historyKey;
    try {
      historyKey = decodeURIComponent(match[1]);
    } catch {
      historyKey = match[1];
    }
    return { name: "detail", historyKey, query };
  }

  if (path === "/group") {
    return { name: "group", query };
  }

  if (path === "/dashboard" || path === "/tasks" || path === "/schedule" || path === "/raffle") {
    return { name: path.slice(1), query };
  }

  // IMPL_PLAN_SH5 §1: `#/starforce` -- the SF cost history chart screen
  // (design DESIGN_SF_COST_HISTORY.md U2). Added as its own block rather
  // than folded into the dashboard/tasks/schedule check above, so that
  // check's existing branch is untouched.
  if (path === "/starforce") {
    return { name: "starforce", query };
  }

  return { name: "list", query };
}

function buildHash(route) {
  const params = serializeQuery(route?.query);
  const search = params.toString();
  const path = route?.name === "detail"
    ? `/character/${encodeURIComponent(route.historyKey)}`
    : route?.name === "group"
      ? "/group"
      : route?.name === "dashboard" || route?.name === "tasks" || route?.name === "schedule" || route?.name === "raffle" || route?.name === "starforce"
        ? `/${route.name}`
        : "/";
  return `#${path}${search ? `?${search}` : ""}`;
}

function routesEqual(a, b) {
  if (!a || !b) {
    return a === b;
  }
  if (a.name !== b.name) {
    return false;
  }
  if (a.name === "detail" && a.historyKey !== b.historyKey) {
    return false;
  }
  const qa = a.query || {};
  const qb = b.query || {};
  return QUERY_PARAM_ORDER.every((key) => String(qa[key]) === String(qb[key]));
}

// ---------------------------------------------------------------------
// Centralized route state (IMPL_PLAN_T2 §5). `applyRoute` is the single
// entry point for in-app navigation: it always updates the URL (via
// pushState/replaceState) and the shared route state together, so the
// screen never depends on a `hashchange` event firing (replaceState does
// not fire one). Multiple `applyRoute` calls issued synchronously within
// the same tick (e.g. a click handler that flips several filters at
// once) are coalesced into a single history entry via a microtask flush,
// so one discrete user action never produces multiple back-button stops.
// ---------------------------------------------------------------------

let currentRoute = parseHash(typeof window !== "undefined" ? window.location.hash : "");
const listeners = new Set();

let pendingRoute = null;
let pendingReplace = true;
let flushScheduled = false;

function notify() {
  listeners.forEach((listener) => listener(currentRoute));
}

function commitRoute(nextRoute, { replace }) {
  const hash = buildHash(nextRoute);
  if (window.location.hash !== hash) {
    window.history[replace ? "replaceState" : "pushState"](null, "", hash);
  }
  if (!routesEqual(nextRoute, currentRoute)) {
    currentRoute = nextRoute;
    notify();
  }
}

function flush() {
  flushScheduled = false;
  const nextRoute = pendingRoute;
  const replace = pendingReplace;
  pendingRoute = null;
  pendingReplace = true;
  if (!nextRoute) {
    return;
  }
  commitRoute(nextRoute, { replace });
}

function scheduleFlush() {
  if (flushScheduled) {
    return;
  }
  flushScheduled = true;
  queueMicrotask(flush);
}

function latestRoute() {
  return pendingRoute || currentRoute;
}

/**
 * Centralized navigate function. `nextRoute` may be a route object or an
 * updater `(latestRoute) => route` (so a series of same-tick calls chain
 * off each other instead of a stale snapshot). `replace: true` = history
 * replace (free-text input); `replace: false` (default) = history push
 * (discrete operation). If any call in a same-tick batch requests push,
 * the whole batch is committed as a single push.
 */
export function applyRoute(nextRoute, { replace = false } = {}) {
  const base = latestRoute();
  pendingRoute = typeof nextRoute === "function" ? nextRoute(base) : nextRoute;
  pendingReplace = pendingReplace && replace;
  scheduleFlush();
}

/** Re-parses `window.location.hash`, normalizing it in place (replaceState,
 * no new history entry) if it doesn't match its canonical form, and
 * updates the shared route state if it actually changed (idempotent). */
function syncFromLocation() {
  const parsed = parseHash(window.location.hash);
  const canonicalHash = buildHash(parsed);
  if (window.location.hash && window.location.hash !== canonicalHash) {
    window.history.replaceState(null, "", canonicalHash);
  }
  if (!routesEqual(parsed, currentRoute)) {
    currentRoute = parsed;
    notify();
  }
}

/**
 * Subscribes to the shared route (hash path + query). Handles all
 * sources of route change: initial mount, back/forward (`popstate`),
 * and direct/manual hash edits or legacy link navigation (`hashchange`).
 * Both listeners funnel through the same parse/normalize path and are
 * idempotent, so redundant firing for a single browser navigation is a
 * no-op. Listeners are removed on unmount.
 */
export function useHashRoute() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const listener = (next) => setRoute(next);
    listeners.add(listener);

    // Normalize/catch up on mount (covers a URL pasted or hash-edited
    // before this component subscribed).
    syncFromLocation();
    setRoute(currentRoute);

    function handleExternalChange() {
      syncFromLocation();
    }
    window.addEventListener("popstate", handleExternalChange);
    window.addEventListener("hashchange", handleExternalChange);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("popstate", handleExternalChange);
      window.removeEventListener("hashchange", handleExternalChange);
    };
  }, []);

  return route;
}

/** Navigates to `#/`, keeping (or patching) the current query. */
export function navigateToList(partialQuery = {}, options = {}) {
  applyRoute(
    (base) => ({ name: "list", query: normalizeQuery({ ...base.query, ...partialQuery }) }),
    options,
  );
}

/** Navigates to `#/character/:historyKey`, keeping (or patching) the current query. */
export function navigateToCharacter(historyKey, partialQuery = {}, options = {}) {
  applyRoute(
    (base) => ({
      name: "detail",
      historyKey,
      query: normalizeQuery({ ...base.query, ...partialQuery }),
    }),
    options,
  );
}

/** Navigates to `#/group`, keeping (or patching) the current query (T4b
 * §22.4). No groupId parameter — decision C keeps the active group out of
 * the URL entirely (existing activeGroupId/localStorage stays the single
 * source of truth for which group is shown). */
export function navigateToGroup(partialQuery = {}, options = {}) {
  applyRoute(
    (base) => ({ name: "group", query: normalizeQuery({ ...base.query, ...partialQuery }) }),
    options,
  );
}

/** Navigates to a Task Manager page while keeping the shared query shape.
 * Only registered tool routes are accepted; invalid input returns
 * to the ranking list instead of creating an unknown URL. */
export function navigateToTool(name, options = {}) {
  const target = name === "dashboard" || name === "tasks" || name === "schedule" || name === "raffle"
    ? name
    : "list";
  applyRoute(
    (base) => ({ name: target, query: normalizeQuery(base.query) }),
    options,
  );
}

/** Navigates to `#/starforce` (IMPL_PLAN_SH5 §1), keeping the shared query
 * shape. New function, added alongside the existing navigate* helpers
 * without altering any of them. */
export function navigateToStarforce(options = {}) {
  applyRoute(
    (base) => ({ name: "starforce", query: normalizeQuery(base.query) }),
    options,
  );
}
