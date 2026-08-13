import { afterEach, describe, expect, it, vi } from "vitest";
import { copyPngBlobToClipboard, downloadBlob } from "./shareImageIO.js";

// vitest.config.js runs this file under environment: "node" (no jsdom), so
// every browser global these functions touch (navigator, document, window,
// URL, ClipboardItem) is stubbed per-test, mirroring the pattern already
// used by src/board/useHashRoute.test.js. `navigator` specifically must go
// through vi.stubGlobal: modern Node exposes a read-only built-in
// `globalThis.navigator`, so a plain assignment throws.
afterEach(() => {
  vi.unstubAllGlobals();
  delete globalThis.ClipboardItem;
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.URL;
  vi.restoreAllMocks();
});

const FAKE_BLOB = { type: "image/png" };

describe("copyPngBlobToClipboard", () => {
  it("writes the blob via navigator.clipboard.write and returns true on success", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { write } });
    globalThis.ClipboardItem = class ClipboardItem {
      constructor(items) {
        this.items = items;
      }
    };

    const ok = await copyPngBlobToClipboard(FAKE_BLOB);

    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    const [items] = write.mock.calls[0];
    expect(items[0]).toBeInstanceOf(globalThis.ClipboardItem);
    expect(items[0].items).toEqual({ "image/png": FAKE_BLOB });
  });

  it("returns false (without throwing) when clipboard.write rejects", async () => {
    vi.stubGlobal("navigator", { clipboard: { write: vi.fn().mockRejectedValue(new Error("denied")) } });
    globalThis.ClipboardItem = class ClipboardItem {};

    await expect(copyPngBlobToClipboard(FAKE_BLOB)).resolves.toBe(false);
  });

  it("returns false when navigator.clipboard.write is unavailable (non-secure context)", async () => {
    vi.stubGlobal("navigator", {});
    globalThis.ClipboardItem = class ClipboardItem {};

    expect(await copyPngBlobToClipboard(FAKE_BLOB)).toBe(false);
  });

  it("returns false when ClipboardItem is undefined (unsupported browser)", async () => {
    vi.stubGlobal("navigator", { clipboard: { write: vi.fn() } });

    expect(await copyPngBlobToClipboard(FAKE_BLOB)).toBe(false);
  });
});

describe("downloadBlob", () => {
  it("creates a temporary object URL, clicks a download link, then revokes the URL", () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const link = { href: "", download: "", click };
    const appended = [];
    globalThis.document = {
      createElement: vi.fn(() => link),
      body: {
        appendChild: vi.fn((el) => appended.push(["append", el])),
        removeChild: vi.fn((el) => appended.push(["remove", el])),
      },
    };
    globalThis.window = { setTimeout: (fn, ms) => setTimeout(fn, ms) };
    globalThis.URL = {
      createObjectURL: vi.fn(() => "blob:fake-url"),
      revokeObjectURL: vi.fn(),
    };

    downloadBlob(FAKE_BLOB, "settlement.png");

    expect(globalThis.URL.createObjectURL).toHaveBeenCalledWith(FAKE_BLOB);
    expect(link.href).toBe("blob:fake-url");
    expect(link.download).toBe("settlement.png");
    expect(click).toHaveBeenCalledTimes(1);
    expect(appended).toEqual([
      ["append", link],
      ["remove", link],
    ]);
    expect(globalThis.URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
    vi.useRealTimers();
  });
});
