import { describe, expect, it } from "vitest";

// Smoke test confirming vitest is wired up (environment=node, include path).
// Replaced/complemented by real stats/*.test.js in later commits.
describe("vitest setup", () => {
  it("runs a trivial assertion", () => {
    expect(1 + 1).toBe(2);
  });
});
