import { describe, expect, it } from "vitest";
import { resolveSiteNavHref } from "./BoardHeader.jsx";

// SH-24: VPS-only build points EXP Ranking / Task Manager / brand at the
// absolute main-site URL via VITE_SITE_BASE_URL; SF履歴 (#/starforce) is
// hardcoded in BoardHeader.jsx and never routed through this helper, so it
// is not exercised here -- it stays "#/starforce" regardless of env.
describe("resolveSiteNavHref", () => {
  it("(a) returns the hash path unchanged when siteBaseUrl is unset (default build)", () => {
    // Mirrors import.meta.env.VITE_SITE_BASE_URL being unset -> "" default.
    expect(resolveSiteNavHref("#/", "")).toBe("#/");
    expect(resolveSiteNavHref("#/dashboard", "")).toBe("#/dashboard");
  });

  it("(a) returns the hash path unchanged when siteBaseUrl is omitted entirely", () => {
    expect(resolveSiteNavHref("#/")).toBe(resolveSiteNavHref("#/", ""));
    expect(resolveSiteNavHref("#/dashboard")).toBe(resolveSiteNavHref("#/dashboard", ""));
  });

  it("(b) builds an absolute URL when siteBaseUrl is set", () => {
    expect(resolveSiteNavHref("#/", "https://lulumi-tools.com")).toBe(
      "https://lulumi-tools.com/#/"
    );
    expect(resolveSiteNavHref("#/dashboard", "https://lulumi-tools.com")).toBe(
      "https://lulumi-tools.com/#/dashboard"
    );
  });

  it("(c) trailing slash on siteBaseUrl yields the same result as no trailing slash", () => {
    expect(resolveSiteNavHref("#/", "https://lulumi-tools.com/")).toBe(
      resolveSiteNavHref("#/", "https://lulumi-tools.com")
    );
    expect(resolveSiteNavHref("#/dashboard", "https://lulumi-tools.com/")).toBe(
      resolveSiteNavHref("#/dashboard", "https://lulumi-tools.com")
    );
  });

  it("(c) collapses multiple trailing slashes on siteBaseUrl the same way", () => {
    expect(resolveSiteNavHref("#/", "https://lulumi-tools.com///")).toBe(
      "https://lulumi-tools.com/#/"
    );
  });
});
