import { afterEach, describe, expect, it, vi } from "vitest";

// This module (§22.4) keeps a module-level singleton route (`currentRoute`)
// seeded from `window.location.hash` at import time, mutated by
// `applyRoute`. To test the stateful navigate* functions without one test's
// navigation leaking into the next, every test that touches them installs
// its own fake `window` and imports a *fresh* module instance via
// `vi.resetModules()` + dynamic `import()`. Tests that only exercise the
// pure `parseHash` need neither.
function installFakeWindow(initialHash = "") {
  const win = {
    location: { hash: initialHash },
    history: {
      pushState(_state, _title, url) {
        win.location.hash = url;
      },
      replaceState(_state, _title, url) {
        win.location.hash = url;
      },
    },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = win;
  return win;
}

async function freshModule() {
  vi.resetModules();
  return import("./useHashRoute.js");
}

/** Flushes the module's microtask-batched route commit (queueMicrotask). */
async function flushRouteCommit() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  delete globalThis.window;
});

describe("parseHash: #/group (T4b §22.4)", () => {
  it("parses '#/group' (no query) to { name: 'group', query: <defaults> }", async () => {
    const { parseHash, normalizeQuery } = await freshModule();
    const route = parseHash("#/group");
    expect(route.name).toBe("group");
    expect(route.query).toEqual(normalizeQuery({}));
    // Decision C: group carries no groupId/id field of its own.
    expect(route.historyKey).toBeUndefined();
    expect(route.groupId).toBeUndefined();
  });

  it("parses '#/group?sort=weekly&page=2' keeping the query", async () => {
    const { parseHash } = await freshModule();
    const route = parseHash("#/group?sort=weekly&page=2");
    expect(route.name).toBe("group");
    expect(route.query.sort).toBe("weekly");
    expect(route.query.page).toBe("2");
  });

  it("ignores a groupId-like query param (not part of the query contract)", async () => {
    const { parseHash } = await freshModule();
    const route = parseHash("#/group?groupId=abc123");
    expect(route.name).toBe("group");
    expect(route.groupId).toBeUndefined();
  });

  it("falls back to list for unknown paths (never crashes)", async () => {
    const { parseHash } = await freshModule();
    expect(parseHash("#/groups").name).toBe("list");
    expect(parseHash("#/nonsense/path").name).toBe("list");
    expect(parseHash("").name).toBe("list");
  });

  it("still parses '#/' and '#/character/:key' as before (no regression)", async () => {
    const { parseHash } = await freshModule();
    expect(parseHash("#/").name).toBe("list");
    const detail = parseHash("#/character/asset%3Aabc");
    expect(detail.name).toBe("detail");
    expect(detail.historyKey).toBe("asset:abc");
  });
});

describe("parseHash: Task Manager routes", () => {
  it.each([
    ["#/dashboard", "dashboard"],
    ["#/tasks", "tasks"],
    ["#/schedule", "schedule"],
    ["#/raffle", "raffle"],
  ])("parses %s as %s", async (hash, name) => {
    const { parseHash } = await freshModule();
    expect(parseHash(hash).name).toBe(name);
  });

  it("keeps unknown and empty hashes on the ranking list", async () => {
    const { parseHash } = await freshModule();
    expect(parseHash("#/task").name).toBe("list");
    expect(parseHash("").name).toBe("list");
  });
});

describe("navigateToGroup / navigateToList round trip (T4b §22.4)", () => {
  it("navigateToGroup() from the list produces '#/group', preserving the current query", async () => {
    installFakeWindow("#/?sort=weekly&minLevel=230");
    const { navigateToGroup, parseHash } = await freshModule();

    navigateToGroup();
    await flushRouteCommit();

    const hash = globalThis.window.location.hash;
    expect(hash.startsWith("#/group")).toBe(true);
    const reparsed = parseHash(hash);
    expect(reparsed.name).toBe("group");
    expect(reparsed.query.sort).toBe("weekly");
    expect(reparsed.query.minLevel).toBe("230");
  });

  it("navigateToList() from '#/group' (back button) restores the list route with the same query", async () => {
    installFakeWindow("#/group?sort=weekly&minLevel=230");
    const { navigateToList, parseHash } = await freshModule();

    navigateToList();
    await flushRouteCommit();

    const hash = globalThis.window.location.hash;
    const reparsed = parseHash(hash);
    expect(reparsed.name).toBe("list");
    expect(reparsed.query.sort).toBe("weekly");
    expect(reparsed.query.minLevel).toBe("230");
  });

  it("navigateToGroup(partialQuery) merges onto the current query like navigateToCharacter does", async () => {
    installFakeWindow("#/?sort=daily");
    const { navigateToGroup, parseHash } = await freshModule();

    navigateToGroup({ sort: "monthly" });
    await flushRouteCommit();

    const reparsed = parseHash(globalThis.window.location.hash);
    expect(reparsed.name).toBe("group");
    expect(reparsed.query.sort).toBe("monthly");
  });
});

describe("navigateToTool", () => {
  it("navigates to each registered Task Manager page", async () => {
    installFakeWindow("#/");
    const { navigateToTool, parseHash } = await freshModule();

    for (const name of ["dashboard", "tasks", "schedule", "raffle"]) {
      navigateToTool(name);
      await flushRouteCommit();
      expect(parseHash(globalThis.window.location.hash).name).toBe(name);
    }
  });

  it("falls back to the ranking list for an invalid tool name", async () => {
    installFakeWindow("#/dashboard");
    const { navigateToTool, parseHash } = await freshModule();

    navigateToTool("unknown");
    await flushRouteCommit();

    expect(parseHash(globalThis.window.location.hash).name).toBe("list");
  });
});
