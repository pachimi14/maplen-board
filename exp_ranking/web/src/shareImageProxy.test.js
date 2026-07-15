import { describe, expect, it } from "vitest";
import { toShareProxyUrl } from "./shareImageProxy.js";

describe("toShareProxyUrl", () => {
  it("converts market-static charimages URLs to the share image proxy", () => {
    expect(
      toShareProxyUrl(
        "https://market-static.msu.io/msu/platform/charimages/transient/abcDEF_012=-.png",
        "https://api.lulumi-tools.com/",
      ),
    ).toBe("https://api.lulumi-tools.com/img/charimages/transient/abcDEF_012=-.png");
  });

  it("returns null when the proxy is disabled", () => {
    expect(
      toShareProxyUrl(
        "https://market-static.msu.io/msu/platform/charimages/transient/abc.png",
        null,
      ),
    ).toBeNull();
  });

  it("rejects non-market URLs and non-charimage paths", () => {
    expect(toShareProxyUrl("https://example.com/msu/platform/charimages/transient/abc.png")).toBeNull();
    expect(toShareProxyUrl("https://market-static.msu.io/msu/platform/items/abc.png")).toBeNull();
  });

  it("rejects unsafe paths", () => {
    expect(
      toShareProxyUrl("https://market-static.msu.io/msu/platform/charimages/transient/../abc.png"),
    ).toBeNull();
    expect(
      toShareProxyUrl("https://market-static.msu.io/msu/platform/charimages/transient/abc.jpg"),
    ).toBeNull();
    expect(
      toShareProxyUrl("https://market-static.msu.io/msu/platform/charimages/transient/abc%20def.png"),
    ).toBeNull();
  });
});
