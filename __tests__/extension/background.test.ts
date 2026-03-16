/**
 * Tests for chrome-extension/background.js — side panel message relay.
 *
 * background.js is a plain browser script (no exports), so we load it in a
 * vm sandbox with a mocked chrome global. Each call to loadBackground()
 * produces a fresh sandbox so tests are fully isolated.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const BACKGROUND_SRC = readFileSync(
  resolve("chrome-extension/background.js"),
  "utf8"
);

type MockFn = ReturnType<typeof vi.fn>;

/**
 * Evaluates background.js in a vm sandbox with a mocked chrome global.
 * Returns references to every registered event listener so tests can invoke
 * them directly without touching real Chrome APIs.
 */
function loadBackground() {
  const runtimeMsgListeners: ((msg: unknown, sender: unknown, sendResponse: MockFn) => boolean | void)[] = [];
  const tabActivatedListeners: ((info: { tabId: number }) => void)[] = [];
  const tabUpdatedListeners: ((tabId: number, changeInfo: unknown) => void)[] = [];

  const chrome = {
    sidePanel: {
      setPanelBehavior: vi.fn().mockReturnValue({ catch: vi.fn() }),
    },
    runtime: {
      onMessage: {
        addListener: (fn: (msg: unknown, sender: unknown, sendResponse: MockFn) => boolean | void) =>
          runtimeMsgListeners.push(fn),
      },
      sendMessage: vi.fn().mockReturnValue({ catch: vi.fn() }),
    },
    tabs: {
      query: vi.fn(),
      sendMessage: vi.fn().mockReturnValue({ catch: vi.fn() }),
      onActivated: {
        addListener: (fn: (info: { tabId: number }) => void) =>
          tabActivatedListeners.push(fn),
      },
      onUpdated: {
        addListener: (fn: (tabId: number, changeInfo: unknown) => void) =>
          tabUpdatedListeners.push(fn),
      },
    },
    scripting: {
      executeScript: vi.fn().mockResolvedValue(undefined),
    },
  };

  vm.runInNewContext(BACKGROUND_SRC, {
    chrome,
    Promise: globalThis.Promise,
    JSON:    globalThis.JSON,
    console: globalThis.console,
  });

  return { chrome, runtimeMsgListeners, tabActivatedListeners, tabUpdatedListeners };
}

// ---------------------------------------------------------------------------

describe("background.js — side panel setup", () => {
  it("calls setPanelBehavior with openPanelOnActionClick: true on load", () => {
    const { chrome } = loadBackground();
    expect(chrome.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    });
  });
});

// ---------------------------------------------------------------------------

describe("background.js — get-tab-url message", () => {
  it("queries the active tab and returns url + tabId via sendResponse", () => {
    const { chrome, runtimeMsgListeners } = loadBackground();

    chrome.tabs.query.mockImplementation((_q: unknown, cb: (tabs: unknown[]) => void) => {
      cb([{ url: "https://example.com/article", id: 42 }]);
    });

    const sendResponse = vi.fn();
    runtimeMsgListeners[0]({ type: "get-tab-url" }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      url: "https://example.com/article",
      tabId: 42,
    });
  });

  it("returns null url and tabId when no active tab is found", () => {
    const { chrome, runtimeMsgListeners } = loadBackground();

    chrome.tabs.query.mockImplementation((_q: unknown, cb: (tabs: unknown[]) => void) => {
      cb([]);
    });

    const sendResponse = vi.fn();
    runtimeMsgListeners[0]({ type: "get-tab-url" }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({ url: null, tabId: null });
  });

  it("returns true to keep the message channel open for async sendResponse", () => {
    const { chrome, runtimeMsgListeners } = loadBackground();
    chrome.tabs.query.mockImplementation(() => {}); // never resolves

    const result = runtimeMsgListeners[0]({ type: "get-tab-url" }, {}, vi.fn());
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("background.js — apply-highlights message", () => {
  it("injects content.js into the specified tab", async () => {
    const { chrome, runtimeMsgListeners } = loadBackground();

    runtimeMsgListeners[0](
      { type: "apply-highlights", tabId: 7, excerpts: ["voted 5-4"] },
      {},
      vi.fn()
    );

    await Promise.resolve(); // flush executeScript promise
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ["content.js"],
    });
  });

  it("sends abq-apply-highlights to the tab with the excerpts after injection", async () => {
    const { chrome, runtimeMsgListeners } = loadBackground();

    runtimeMsgListeners[0](
      { type: "apply-highlights", tabId: 7, excerpts: ["voted 5-4", "Officials said"] },
      {},
      vi.fn()
    );

    await Promise.resolve();
    await Promise.resolve(); // flush .then() after executeScript
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {
      type: "abq-apply-highlights",
      excerpts: ["voted 5-4", "Officials said"],
    });
  });
});

// ---------------------------------------------------------------------------

describe("background.js — clear-highlights message", () => {
  it("sends abq-clear-highlights to the specified tab", () => {
    const { chrome, runtimeMsgListeners } = loadBackground();

    runtimeMsgListeners[0](
      { type: "clear-highlights", tabId: 7 },
      {},
      vi.fn()
    );

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {
      type: "abq-clear-highlights",
    });
  });
});

// ---------------------------------------------------------------------------

describe("background.js — pulse-highlight message", () => {
  it("sends abq-pulse with the correct index to the specified tab", () => {
    const { chrome, runtimeMsgListeners } = loadBackground();

    runtimeMsgListeners[0](
      { type: "pulse-highlight", tabId: 7, index: 2 },
      {},
      vi.fn()
    );

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {
      type: "abq-pulse",
      index: 2,
    });
  });
});

// ---------------------------------------------------------------------------

describe("background.js — tab change notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends tab-changed when the active tab changes (onActivated)", () => {
    const { chrome, tabActivatedListeners } = loadBackground();

    tabActivatedListeners[0]({ tabId: 99 });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "tab-changed",
      tabId: 99,
    });
  });

  it("sends tab-changed when a tab finishes loading (onUpdated, status=complete)", () => {
    const { chrome, tabUpdatedListeners } = loadBackground();

    tabUpdatedListeners[0](55, { status: "complete" });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "tab-changed",
      tabId: 55,
    });
  });

  it("does NOT send tab-changed for intermediate onUpdated states", () => {
    const { chrome, tabUpdatedListeners } = loadBackground();

    tabUpdatedListeners[0](55, { status: "loading" });

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
