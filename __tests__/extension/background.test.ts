/**
 * Tests for chrome-extension/background.js — streaming proxy.
 *
 * background.js is a plain browser script (no exports), so we load it in a
 * vm sandbox with a mocked chrome global and mocked fetch. Each call to
 * loadBackground() produces a fresh sandbox so tests are fully isolated.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const BACKGROUND_SRC = readFileSync(
  resolve("chrome-extension/background.js"),
  "utf8"
);

type MockFn = ReturnType<typeof vi.fn>;

interface MockPort {
  name: string;
  onMessage: { addListener: MockFn };
  postMessage: MockFn;
}

function makeMockPort(name = "abq-analyze"): MockPort {
  return {
    name,
    onMessage: { addListener: vi.fn() },
    postMessage: vi.fn(),
  };
}

/**
 * Evaluates background.js in a vm sandbox with a mocked chrome global and the
 * provided fetch mock. Returns references to every registered event listener so
 * tests can invoke them directly without touching real Chrome APIs.
 */
function loadBackground(fetchMock: MockFn) {
  const connectListeners: ((port: MockPort) => void)[] = [];
  const runtimeMsgListeners: ((msg: unknown, sender: unknown) => void)[] = [];
  const tabUpdatedListeners: ((tabId: number, changeInfo: unknown) => void)[] =
    [];

  const chrome = {
    runtime: {
      onConnect: { addListener: (fn: (port: MockPort) => void) => connectListeners.push(fn) },
      onMessage: { addListener: (fn: (msg: unknown, sender: unknown) => void) => runtimeMsgListeners.push(fn) },
    },
    tabs: {
      onUpdated: { addListener: (fn: (tabId: number, changeInfo: unknown) => void) => tabUpdatedListeners.push(fn) },
    },
    action:    { onClicked:   { addListener: vi.fn() } },
    scripting: { executeScript: vi.fn().mockResolvedValue(undefined) },
  };

  vm.runInNewContext(BACKGROUND_SRC, {
    chrome,
    fetch: fetchMock,
    AbortSignal:  globalThis.AbortSignal,
    setTimeout:   (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
    Promise:      globalThis.Promise,
    Set:          globalThis.Set,
    JSON:         globalThis.JSON,
    console:      globalThis.console,
  });

  return { chrome, connectListeners, runtimeMsgListeners, tabUpdatedListeners };
}

/** Simulate opening a port, return the message handler registered by background.js. */
function openPort(port: MockPort, connectListeners: ((port: MockPort) => void)[]) {
  connectListeners[0](port);
  return (port.onMessage.addListener as MockFn).mock.calls[0][0] as (
    msg: unknown
  ) => Promise<void>;
}

// ---------------------------------------------------------------------------

describe("background.js — streaming proxy", () => {
  let fetchMock: MockFn;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it("forwards each valid NDJSON line from the API to the port as a parsed object", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("health")) return Promise.resolve({ ok: true });
      return Promise.resolve({
        ok: true,
        text: () =>
          Promise.resolve(
            '{"type":"progress","stage":"Thinking\u2026"}\n' +
            '{"type":"result","data":{"mode":"bundle"}}\n'
          ),
      });
    });

    const { connectListeners } = loadBackground(fetchMock);
    const port = makeMockPort();
    const handler = openPort(port, connectListeners);

    await handler({ url: "https://example.com/article", chosenUrl: null });

    expect(port.postMessage).toHaveBeenCalledWith({
      type: "progress",
      stage: "Thinking…",
    });
    expect(port.postMessage).toHaveBeenCalledWith({
      type: "result",
      data: { mode: "bundle" },
    });
  });

  it("skips malformed NDJSON lines without crashing and still forwards valid lines", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("health")) return Promise.resolve({ ok: false });
      return Promise.resolve({
        ok: true,
        text: () =>
          Promise.resolve(
            "not-json\n" +
            '{"type":"result","data":{"mode":"bundle"}}\n' +
            "{broken\n"
          ),
      });
    });

    const { connectListeners } = loadBackground(fetchMock);
    const port = makeMockPort();
    const handler = openPort(port, connectListeners);

    await handler({ url: "https://example.com", chosenUrl: null });

    const calls = (port.postMessage as MockFn).mock.calls.map((c) => c[0]);
    // Valid line is forwarded
    expect(calls).toContainEqual({ type: "result", data: { mode: "bundle" } });
    // Malformed lines do not generate an error event
    expect(calls.filter((c: { type: string }) => c.type === "error")).toHaveLength(0);
  });

  it("includes chosenUrl in the API request body when provided", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("health")) return Promise.resolve({ ok: false });
      return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
    });

    const { connectListeners } = loadBackground(fetchMock);
    const port = makeMockPort();
    const handler = openPort(port, connectListeners);

    await handler({
      url: "https://example.com",
      chosenUrl: "https://example.com/article",
    });

    const apiCall = fetchMock.mock.calls.find(([url]: [string]) =>
      url.includes("/api/questions")
    );
    expect(apiCall).toBeDefined();
    const body = JSON.parse(apiCall![1].body);
    expect(body.chosenUrl).toBe("https://example.com/article");
  });

  it("omits chosenUrl from the request body when it is null", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("health")) return Promise.resolve({ ok: false });
      return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
    });

    const { connectListeners } = loadBackground(fetchMock);
    const port = makeMockPort();
    const handler = openPort(port, connectListeners);

    await handler({ url: "https://example.com", chosenUrl: null });

    const apiCall = fetchMock.mock.calls.find(([url]: [string]) =>
      url.includes("/api/questions")
    );
    const body = JSON.parse(apiCall![1].body);
    expect(body).not.toHaveProperty("chosenUrl");
  });

  // ── Error paths ────────────────────────────────────────────────────────────

  it("posts an error event when fetch throws (network failure)", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("health")) return Promise.resolve({ ok: false });
      return Promise.reject(new Error("Network error"));
    });

    const { connectListeners } = loadBackground(fetchMock);
    const port = makeMockPort();
    const handler = openPort(port, connectListeners);

    await handler({ url: "https://example.com", chosenUrl: null });

    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" })
    );
  });

  it("posts an error event when the API returns a non-ok status", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("health")) return Promise.resolve({ ok: false });
      return Promise.resolve({ ok: false, status: 503 });
    });

    const { connectListeners } = loadBackground(fetchMock);
    const port = makeMockPort();
    const handler = openPort(port, connectListeners);

    await handler({ url: "https://example.com", chosenUrl: null });

    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        error: expect.stringContaining("503"),
      })
    );
  });

  it("posts an error event when reading the response body fails", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("health")) return Promise.resolve({ ok: false });
      return Promise.resolve({
        ok: true,
        text: () => Promise.reject(new Error("Body read error")),
      });
    });

    const { connectListeners } = loadBackground(fetchMock);
    const port = makeMockPort();
    const handler = openPort(port, connectListeners);

    await handler({ url: "https://example.com", chosenUrl: null });

    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" })
    );
  });

  // ── Protocol ───────────────────────────────────────────────────────────────

  it("ignores keepalive ping messages without calling fetch", async () => {
    const { connectListeners } = loadBackground(fetchMock);
    const port = makeMockPort();
    const handler = openPort(port, connectListeners);

    await handler({ type: "ping" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it("does not register a message listener for ports with unrecognised names", () => {
    const { connectListeners } = loadBackground(fetchMock);
    const port = makeMockPort("not-abq-analyze");
    connectListeners[0](port);

    expect(port.onMessage.addListener).not.toHaveBeenCalled();
  });

  // ── Health check ───────────────────────────────────────────────────────────

  it("sends __alive__ progress when both health endpoints respond OK before main fetch", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("health")) return Promise.resolve({ ok: true });
      // Main API fetch intentionally hangs so we can observe the health message first
      return new Promise(() => {});
    });

    const { connectListeners } = loadBackground(fetchMock);
    const port = makeMockPort();
    const handler = openPort(port, connectListeners);

    // Don't await — the main fetch hangs, but health check should resolve via microtasks
    handler({ url: "https://example.com", chosenUrl: null }).catch(() => {});

    // Flush microtask queue so health-check Promise.all resolves and .then() fires
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(port.postMessage).toHaveBeenCalledWith({
      type: "progress",
      stage: "__alive__",
    });
  });
});

// ---------------------------------------------------------------------------

describe("background.js — auto-start tab tracking", () => {
  let fetchMock: MockFn;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("injects content.js when a flagged tab finishes loading", async () => {
    const { runtimeMsgListeners, tabUpdatedListeners, chrome } =
      loadBackground(fetchMock);

    // Flag tab 42 for auto-start
    runtimeMsgListeners[0]({ type: "abq-auto-start" }, { tab: { id: 42 } });

    // Simulate the tab completing navigation
    await tabUpdatedListeners[0](42, { status: "complete" });

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 42 } })
    );
  });

  it("does not inject content.js for tabs that were not flagged", async () => {
    const { tabUpdatedListeners, chrome } = loadBackground(fetchMock);

    // No abq-auto-start message for tab 99
    await tabUpdatedListeners[0](99, { status: "complete" });

    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});
