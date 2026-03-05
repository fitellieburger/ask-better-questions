/**
 * @vitest-environment jsdom
 *
 * Integration tests for chrome-extension/content.js.
 *
 * content.js is an IIFE that immediately injects a Shadow DOM panel and opens
 * a chrome.runtime port when evaluated. We load it via eval() with mocked
 * chrome APIs and a jsdom document, then drive the panel by pushing events
 * through the mock port — the same path the real background.js uses.
 *
 * Coverage:
 *   - Panel injection into the document
 *   - Double-injection guard
 *   - Port connection and initial URL message
 *   - progress / result / error / choice event handling
 *   - "settled" flag: unexpected disconnect shows "Connection lost"
 *   - "settled" flag: disconnect after result/error/choice is silent
 *   - Close button removes the panel
 *   - findTextRange: exact, whitespace-collapsed, and unicode-normalised passes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONTENT_SRC = readFileSync(
  resolve("chrome-extension/content.js"),
  "utf8"
);

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const BUNDLE_RESULT = {
  mode: "bundle",
  bundle: {
    fast: [
      { label: "Words",   text: "Does the headline use charged language?",      why: "Loaded words prime readers.",      excerpt: "voted 5-4" },
      { label: "Proof",   text: "What evidence backs this claim?",              why: "Claims need evidence.",            excerpt: "Officials said" },
      { label: "Missing", text: "What context is absent here?",                 why: "Missing context misleads.",        excerpt: "no review" },
    ],
    deeper: [
      { label: "Words",   text: "Which framing steers the first impression?",   why: "Early framing anchors interpretation.", excerpt: "voted 5-4" },
      { label: "Proof",   text: "What specific evidence backs the claim?",      why: "Evidence enables evaluation.",    excerpt: "Officials said" },
      { label: "Missing", text: "What scope goes unstated by the author?",      why: "Limits matter for generalisation.", excerpt: "no review" },
    ],
    cliff: [
      { label: "Words",   text: "The author frames the vote with evaluative language.", why: "Evaluative framing signals interpretation.", excerpt: "voted 5-4" },
      { label: "Proof",   text: "Key claims rest on official statements, not records.", why: "Statements may differ from outcomes.",     excerpt: "Officials said" },
      { label: "Missing", text: "No dissenting expert voice is included.",              why: "One-sided sourcing limits judgment.",      excerpt: "no review" },
    ],
  },
};

// ---------------------------------------------------------------------------
// Mock port factory
// ---------------------------------------------------------------------------

interface MockPort {
  onMessage:    { addListener: ReturnType<typeof vi.fn> };
  onDisconnect: { addListener: ReturnType<typeof vi.fn> };
  postMessage:  ReturnType<typeof vi.fn>;
  disconnect:   ReturnType<typeof vi.fn>;
  /** Push a message from background → content. */
  receive:            (msg: unknown) => void;
  /** Simulate an unexpected port disconnect. */
  simulateDisconnect: () => void;
}

function makeMockPort(): MockPort {
  const msgListeners:        ((msg: unknown) => void)[] = [];
  const disconnectListeners: (() => void)[]             = [];

  return {
    onMessage:    { addListener: vi.fn((fn) => msgListeners.push(fn)) },
    onDisconnect: { addListener: vi.fn((fn) => disconnectListeners.push(fn)) },
    postMessage:  vi.fn(),
    disconnect:   vi.fn(),
    receive:            (msg) => msgListeners.forEach((fn) => fn(msg)),
    simulateDisconnect: ()    => disconnectListeners.forEach((fn) => fn()),
  };
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

/**
 * Evals content.js with the given mock port wired up as chrome.runtime.connect.
 * Removes any pre-existing panel so each test starts fresh.
 */
function runContentScript(port: MockPort) {
  // Remove any leftover panel from a previous test
  document.getElementById("abq-host")?.remove();
  document.getElementById("abq-hl-style")?.remove();

  // Provide a realistic viewport size (jsdom defaults are 0)
  Object.defineProperty(window, "innerWidth",  { value: 1280, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: 800,  configurable: true, writable: true });

  // Mock chrome.runtime
  (globalThis as unknown as Record<string, unknown>).chrome = {
    runtime: {
      connect:     vi.fn(() => port),
      sendMessage: vi.fn(),
    },
  };

  // Stub CSS.highlights — jsdom defines CSS but not CSS.highlights
  Object.defineProperty(globalThis, "CSS", {
    value: {
      highlights: { set: vi.fn(), delete: vi.fn(), has: vi.fn(() => false) },
    },
    configurable: true,
    writable: true,
  });

  // content.js guards against non-http pages; jsdom default is http://localhost/
  // which passes the /^https?:\/\// check fine.

  // eslint-disable-next-line no-eval
  eval(CONTENT_SRC);
}

/** Convenience: get the shadow root of the injected panel. */
function shadow(): ShadowRoot {
  const host = document.getElementById("abq-host");
  if (!host?.shadowRoot) throw new Error("#abq-host or shadowRoot not found");
  return host.shadowRoot;
}

// ---------------------------------------------------------------------------

describe("content.js — panel injection", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(()  => vi.useRealTimers());

  it("injects #abq-host into the document body", () => {
    runContentScript(makeMockPort());
    expect(document.getElementById("abq-host")).not.toBeNull();
  });

  it("attaches a shadow root to #abq-host", () => {
    runContentScript(makeMockPort());
    expect(document.getElementById("abq-host")!.shadowRoot).not.toBeNull();
  });

  it("pushes body paddingTop to match the panel height", () => {
    runContentScript(makeMockPort());
    const host = document.getElementById("abq-host")!;
    expect(document.body.style.paddingTop).toBe(host.style.height);
  });

  it("shows the warmup overlay and hides the main panel on load", () => {
    runContentScript(makeMockPort());
    const s = shadow();
    const warmup = s.querySelector("#abq-warmup") as HTMLElement;
    const main   = s.querySelector("#abq-main")   as HTMLElement;

    expect(warmup.classList.contains("hidden")).toBe(false);
    expect(main.classList.contains("hidden")).toBe(true);
  });

  it("double-injection guard: second eval is a no-op (one panel only)", () => {
    const port = makeMockPort();
    runContentScript(port);
    // Eval again without removing the existing host
    // eslint-disable-next-line no-eval
    eval(CONTENT_SRC);

    expect(document.querySelectorAll("#abq-host")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("content.js — port connection", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(()  => vi.useRealTimers());

  it("calls chrome.runtime.connect with name 'abq-analyze'", () => {
    runContentScript(makeMockPort());
    const chromeMock = (globalThis as unknown as { chrome: { runtime: { connect: ReturnType<typeof vi.fn> } } }).chrome;
    expect(chromeMock.runtime.connect).toHaveBeenCalledWith({ name: "abq-analyze" });
  });

  it("immediately sends the current page URL to the background", () => {
    const port = makeMockPort();
    runContentScript(port);
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ url: window.location.href })
    );
  });
});

// ---------------------------------------------------------------------------

describe("content.js — progress events", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(()  => vi.useRealTimers());

  it("updates the warmup status text for generic stage messages", () => {
    const port = makeMockPort();
    runContentScript(port);

    port.receive({ type: "progress", stage: "Waking up server\u2026" });

    const wuStatus = shadow().querySelector("#abq-wu-status") as HTMLElement;
    expect(wuStatus.textContent).toBe("Waking up server\u2026");
  });

  it("sets status text to 'Analyzing\u2026' for the __alive__ stage", () => {
    const port = makeMockPort();
    runContentScript(port);

    port.receive({ type: "progress", stage: "__alive__" });

    const wuStatus = shadow().querySelector("#abq-wu-status") as HTMLElement;
    expect(wuStatus.textContent).toBe("Analyzing\u2026");
  });
});

// ---------------------------------------------------------------------------

describe("content.js — result event", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(()  => vi.useRealTimers());

  it("makes the main panel visible and hides the warmup overlay", () => {
    const port = makeMockPort();
    runContentScript(port);

    port.receive({ type: "result", data: BUNDLE_RESULT });

    const s      = shadow();
    const warmup = s.querySelector("#abq-warmup") as HTMLElement;
    const main   = s.querySelector("#abq-main")   as HTMLElement;

    // warmup opacity → 0 (hidden class added after 420ms RAF; don't advance timers)
    expect(warmup.style.opacity).toBe("0");
    expect(main.classList.contains("hidden")).toBe(false);
  });

  it("renders the 'fast' tab items (3 list items) by default", () => {
    const port = makeMockPort();
    runContentScript(port);

    port.receive({ type: "result", data: BUNDLE_RESULT });

    const items = shadow().querySelectorAll("#abq-items li");
    expect(items).toHaveLength(3);
  });

  it("renders the label badge for each item", () => {
    const port = makeMockPort();
    runContentScript(port);

    port.receive({ type: "result", data: BUNDLE_RESULT });

    const badges = shadow().querySelectorAll(".item-label");
    const labels = Array.from(badges).map((b) => b.textContent);
    expect(labels).toEqual(["Words", "Proof", "Missing"]);
  });

  it("renders item text safely (escHtml prevents raw HTML in text)", () => {
    const port = makeMockPort();
    runContentScript(port);

    const xssBundle = {
      mode: "bundle",
      bundle: {
        fast:   [{ label: "Words",   text: '<img src=x onerror="alert(1)">?', why: "test" },
                 { label: "Proof",   text: "Safe text?",                       why: "test" },
                 { label: "Missing", text: "Also safe?",                       why: "test" }],
        deeper: BUNDLE_RESULT.bundle.deeper,
        cliff:  BUNDLE_RESULT.bundle.cliff,
      },
    };

    port.receive({ type: "result", data: xssBundle });

    const firstText = shadow().querySelector(".item-text") as HTMLElement;
    // innerHTML should be escaped, not a live <img> element
    expect(firstText.innerHTML).toContain("&lt;img");
    expect(shadow().querySelectorAll("img")).toHaveLength(0);
  });

  it("shows the results section and hides the choice section", () => {
    const port = makeMockPort();
    runContentScript(port);

    port.receive({ type: "result", data: BUNDLE_RESULT });

    const results = shadow().querySelector("#abq-results") as HTMLElement;
    const choice  = shadow().querySelector("#abq-choice")  as HTMLElement;

    expect(results.classList.contains("hidden")).toBe(false);
    expect(choice.classList.contains("hidden")).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("content.js — error event", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(()  => vi.useRealTimers());

  it("displays the error message in the error element", () => {
    const port = makeMockPort();
    runContentScript(port);

    port.receive({ type: "error", error: "Could not reach the API." });

    const errorEl = shadow().querySelector("#abq-error") as HTMLElement;
    expect(errorEl.classList.contains("hidden")).toBe(false);
    expect(errorEl.textContent).toContain("Could not reach the API.");
  });

  it("appends a detail to the error message when provided", () => {
    const port = makeMockPort();
    runContentScript(port);

    port.receive({ type: "error", error: "Extraction failed.", detail: "Rate limited." });

    const errorEl = shadow().querySelector("#abq-error") as HTMLElement;
    expect(errorEl.textContent).toContain("Rate limited.");
  });

  it("makes the main panel visible when an error is shown", () => {
    const port = makeMockPort();
    runContentScript(port);

    port.receive({ type: "error", error: "Something went wrong." });

    const main = shadow().querySelector("#abq-main") as HTMLElement;
    expect(main.classList.contains("hidden")).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("content.js — choice event", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(()  => vi.useRealTimers());

  it("renders candidate buttons in the choice panel", () => {
    const port = makeMockPort();
    runContentScript(port);

    port.receive({
      type: "choice",
      data: {
        needsChoice: true,
        candidates: [
          { title: "Story One", url: "https://example.com/1" },
          { title: "Story Two", url: "https://example.com/2" },
        ],
      },
    });

    const buttons = shadow().querySelectorAll("#abq-candidates button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe("Story One");
    expect(buttons[1].textContent).toBe("Story Two");
  });

  it("shows the choice panel and the main panel", () => {
    const port = makeMockPort();
    runContentScript(port);

    port.receive({
      type: "choice",
      data: { needsChoice: true, candidates: [{ title: "A", url: "https://a.com" }] },
    });

    const choiceEl = shadow().querySelector("#abq-choice") as HTMLElement;
    const mainEl   = shadow().querySelector("#abq-main")   as HTMLElement;

    expect(choiceEl.classList.contains("hidden")).toBe(false);
    expect(mainEl.classList.contains("hidden")).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("content.js — settled flag and disconnect handling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(()  => vi.useRealTimers());

  it("shows 'Connection lost' on unexpected port disconnect (not settled)", () => {
    const port = makeMockPort();
    runContentScript(port);

    // Disconnect without any terminal event → not settled
    port.simulateDisconnect();

    const errorEl = shadow().querySelector("#abq-error") as HTMLElement;
    expect(errorEl.textContent).toContain("Connection lost");
  });

  it("does NOT show 'Connection lost' after a result event (settled)", () => {
    const port = makeMockPort();
    runContentScript(port);

    port.receive({ type: "result", data: BUNDLE_RESULT });
    port.simulateDisconnect();

    const errorEl = shadow().querySelector("#abq-error") as HTMLElement;
    expect(errorEl.classList.contains("hidden")).toBe(true);
  });

  it("does NOT show 'Connection lost' after an error event (settled)", () => {
    const port = makeMockPort();
    runContentScript(port);

    port.receive({ type: "error", error: "API error 500." });
    port.simulateDisconnect();

    const errorEl = shadow().querySelector("#abq-error") as HTMLElement;
    // Error from the API is shown, but not an additional "Connection lost"
    expect(errorEl.textContent).not.toContain("Connection lost");
  });

  it("does NOT show 'Connection lost' after a choice event (settled)", () => {
    const port = makeMockPort();
    runContentScript(port);

    port.receive({
      type: "choice",
      data: { needsChoice: true, candidates: [{ title: "A", url: "https://a.com" }] },
    });
    port.simulateDisconnect();

    const errorEl = shadow().querySelector("#abq-error") as HTMLElement;
    expect(errorEl.classList.contains("hidden")).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("content.js — close button", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(()  => vi.useRealTimers());

  it("removes #abq-host from the document when clicked", () => {
    const port = makeMockPort();
    runContentScript(port);

    const closeBtn = shadow().querySelector("#abq-close") as HTMLButtonElement;
    closeBtn.click();

    expect(document.getElementById("abq-host")).toBeNull();
  });

  it("restores body paddingTop to its original value when closed", () => {
    document.body.style.paddingTop = "0px";
    const port = makeMockPort();
    runContentScript(port);

    const closeBtn = shadow().querySelector("#abq-close") as HTMLButtonElement;
    closeBtn.click();

    expect(document.body.style.paddingTop).toBe("0px");
  });
});

// ---------------------------------------------------------------------------

describe("content.js — findTextRange (via highlight application)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(()  => vi.useRealTimers());

  /**
   * Sets up a document body containing article text, then sends a result event
   * with a matching excerpt. If findTextRange succeeds, CSS.highlights.set is
   * called with the highlight name "abq-hl".
   */
  function setupWithArticle(articleText: string, excerpt: string) {
    // Mock Highlight constructor before runContentScript so it's available
    // when applyHighlights calls `new Highlight(...)`.
    (globalThis as unknown as Record<string, unknown>).Highlight = class {
      constructor(..._ranges: unknown[]) {}
    };

    // Put article text into the page body (outside the panel)
    const article = document.createElement("article");
    article.textContent = articleText;
    document.body.appendChild(article);

    // Run the content script — this installs its own CSS.highlights mock
    const port = makeMockPort();
    runContentScript(port);

    // Capture the spy that runContentScript installed (not a prior one)
    const hlSet = (globalThis as unknown as { CSS: { highlights: { set: ReturnType<typeof vi.fn> } } }).CSS.highlights.set;

    const bundle = {
      mode: "bundle",
      bundle: {
        fast: [
          { label: "Words",   text: "Question one?", why: "why", excerpt },
          { label: "Proof",   text: "Question two?", why: "why" },
          { label: "Missing", text: "Question three?", why: "why" },
        ],
        deeper: BUNDLE_RESULT.bundle.deeper,
        cliff:  BUNDLE_RESULT.bundle.cliff,
      },
    };

    port.receive({ type: "result", data: bundle });

    article.remove();
    return { hlSet };
  }

  it("pass 1 (exact): finds an exact match and registers a highlight", () => {
    const { hlSet } = setupWithArticle(
      "The city council voted 5-4 to approve the ordinance.",
      "voted 5-4 to approve"
    );
    expect(hlSet).toHaveBeenCalledWith("abq-hl", expect.anything());
  });

  it("pass 2 (whitespace-collapsed): matches excerpt across extra whitespace", () => {
    // Article has double space; excerpt uses single space
    const { hlSet } = setupWithArticle(
      "The council  voted  to approve.",
      "council voted to approve"
    );
    expect(hlSet).toHaveBeenCalledWith("abq-hl", expect.anything());
  });

  it("pass 3 (unicode-normalised): matches when article uses smart quotes, excerpt uses straight", () => {
    // Article has right single quote (U+2019), excerpt uses straight apostrophe
    const { hlSet } = setupWithArticle(
      "The mayor\u2019s office confirmed the vote.",
      "mayor's office confirmed"
    );
    expect(hlSet).toHaveBeenCalledWith("abq-hl", expect.anything());
  });

  it("returns null (no highlight) when the excerpt is not present in the page", () => {
    const { hlSet } = setupWithArticle(
      "Completely unrelated text about something else.",
      "voted 5-4 to approve"
    );
    // hlSet should NOT be called with "abq-hl" since no match was found
    const calls = hlSet.mock.calls.filter(([name]: [string]) => name === "abq-hl");
    expect(calls).toHaveLength(0);
  });
});
