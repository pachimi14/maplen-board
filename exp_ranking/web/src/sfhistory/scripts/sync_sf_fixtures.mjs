#!/usr/bin/env node
// Regenerates src/sfhistory/__fixtures__/sf_expected.json from maplenEnhancebot's parity
// fixtures (tools/parity/sf_fixtures/{itemId}.prices.json + {itemId}.percentiles.json).
//
// Only `expected` is taken from each span in percentiles.json - p50/p70/p90 are
// intentionally NOT copied (docs/DESIGN_SF_COST_HISTORY.md §12: this tool does not
// display percentiles; analyticStarforceCostPercentiles / starforceCost are not vendored).
//
// This is the golden data for starforce.test.js, which asserts that the vendored
// expectedStarforceCostExact() in ../starforce.js reproduces `expected` for every span
// within a 1e-12 relative error (IMPL_PLAN_SH4.md §4c).
//
// Usage:
//   node src/sfhistory/scripts/sync_sf_fixtures.mjs [pathToMaplenEnhancebotRepo]
//
// The maplenEnhancebot checkout path can also be supplied via the MAPLEN_ENHANCEBOT_DIR
// env var. Defaults to the sibling `maplenEnhancebot` directory next to this repo's
// checkout root (dev-machine convention - override with the arg/env var elsewhere).

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveSourceRepo() {
  const fromArg = process.argv[2];
  const fromEnv = process.env.MAPLEN_ENHANCEBOT_DIR;
  // scripts/ -> sfhistory/ -> src/ -> web/ -> exp_ranking/ -> <repo root> -> <Desktop> -> maplenEnhancebot
  const fromDefault = resolve(__dirname, "../../../../../../maplenEnhancebot");
  const candidate = resolve(fromArg ?? fromEnv ?? fromDefault);
  if (!existsSync(join(candidate, "packages", "engine", "src", "starforce.ts"))) {
    throw new Error(
      `maplenEnhancebot repo not found at ${candidate} (looked for packages/engine/src/starforce.ts). ` +
        `Pass the path as an argument or set MAPLEN_ENHANCEBOT_DIR.`,
    );
  }
  return candidate;
}

function main() {
  const sourceRepo = resolveSourceRepo();
  const fixturesDir = join(sourceRepo, "tools", "parity", "sf_fixtures");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: sourceRepo })
    .toString()
    .trim();

  const priceFiles = readdirSync(fixturesDir).filter((f) => f.endsWith(".prices.json"));
  const itemIds = priceFiles
    .map((f) => f.replace(/\.prices\.json$/, ""))
    .sort((a, b) => Number(a) - Number(b));

  const items = itemIds.map((itemId) => {
    const prices = JSON.parse(readFileSync(join(fixturesDir, `${itemId}.prices.json`), "utf8"));
    const percentiles = JSON.parse(
      readFileSync(join(fixturesDir, `${itemId}.percentiles.json`), "utf8"),
    );
    const spans = Object.entries(percentiles.spans).map(([span, data]) => {
      const [from, to] = span.split("-").map(Number);
      return { from, to, expected: data.expected };
    });
    spans.sort((a, b) => a.from - b.from || a.to - b.to);
    return { itemId: Number(itemId), prices, spans };
  });

  const output = {
    sourceRepo: "maplenEnhancebot",
    sourceCommit,
    generatedAt: new Date().toISOString(),
    items,
  };

  const outPath = join(__dirname, "..", "__fixtures__", "sf_expected.json");
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);

  const spanCount = items.reduce((sum, item) => sum + item.spans.length, 0);
  console.log(`Wrote ${outPath}`);
  console.log(`items: ${items.length}, spans: ${spanCount}, sourceCommit: ${sourceCommit}`);
}

main();
