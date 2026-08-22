import { describe, expect, it } from "vitest";
import { shouldLoadRankingData } from "./useRankingBoard.js";

// IMPL_PLAN_SH46 §2/§6(a)(b): the exclude-list predicate that decides
// whether `useRankingBoard`'s ranking-data fetch (`rankings.json` +
// `shard-51.json`) is started for a given route. Kept as a plain,
// React-free pure function (not exercised via rendering the hook itself --
// vitest.config.js runs this suite in `environment: "node"`, no jsdom/
// testing-library, per CubeLegend.test.js's own precedent of not adding a
// new dependency for that) so the routing decision itself has a direct,
// fast, deterministic regression test independent of React's effect
// timing.
describe("shouldLoadRankingData (IMPL_PLAN_SH46 §2)", () => {
  it("is false for the three Enhance History routes -- they never read characters/meta", () => {
    expect(shouldLoadRankingData("starforce")).toBe(false);
    expect(shouldLoadRankingData("starforceDiscovery")).toBe(false);
    expect(shouldLoadRankingData("starforceCubePrices")).toBe(false);
  });

  it("is true for every ranking-consuming route, including Task Manager and raffle (plan §2: 'Task Manager 系は対象外' -- unchanged)", () => {
    expect(shouldLoadRankingData("list")).toBe(true);
    expect(shouldLoadRankingData("detail")).toBe(true);
    expect(shouldLoadRankingData("group")).toBe(true);
    expect(shouldLoadRankingData("dashboard")).toBe(true);
    expect(shouldLoadRankingData("tasks")).toBe(true);
    expect(shouldLoadRankingData("schedule")).toBe(true);
    expect(shouldLoadRankingData("raffle")).toBe(true);
  });

  it("defaults to true (needs ranking data) for any unrecognized route name -- a future new route is never silently starved of data", () => {
    expect(shouldLoadRankingData("someFutureRoute")).toBe(true);
    expect(shouldLoadRankingData(undefined)).toBe(true);
  });
});
