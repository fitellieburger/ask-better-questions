/**
 * @vitest-environment jsdom
 *
 * Tests for chrome-extension/content.js — highlights-only content script.
 *
 * content.js is an IIFE that installs CSS Custom Highlights and registers a
 * chrome.runtime.onMessage listener. We load it via eval() with mocked APIs
 * and drive it by invoking the registered message handler directly.
 *
 * Coverage:
 *   - Double-injection guard (second eval is a no-op)
 *   - findTextRange: exact, whitespace-collapsed, unicode-normalised, and no-match
 *   - Message listener: abq-apply-highlights, abq-clear-highlights, abq-pulse
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONTENT_SRC = readFileSync(
  resolve("chrome-extension/content.js"),
  "utf8"
);

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

type MsgListener = (msg: { type: string; excerpts?: string[]; index?: number }) => void;

interface Harness {
  hlSet:    ReturnType<typeof vi.fn>;
  hlDelete: ReturnType<typeof vi.fn>;
  dispatch: MsgListener;
}

/**
 * Evals content.js with mocked chrome and CSS globals.
 * Returns the CSS.highlights spies and the registered message handler.
 */
function runContentScript(): Harness {
  document.getElementById("abq-hl-style")?.remove();

  const msgListeners: MsgListener[] = [];

  (globalThis as unknown as Record<string, unknown>).chrome = {
    runtime: {
      onMessage: {
        addListener: (fn: MsgListener) => msgListeners.push(fn),
      },
    },
  };

  const hlSet    = vi.fn();
  const hlDelete = vi.fn();

  Object.defineProperty(globalThis, "CSS", {
    value: { highlights: { set: hlSet, delete: hlDelete } },
    configurable: true,
    writable: true,
  });

  (globalThis as unknown as Record<string, unknown>).Highlight = class {
    constructor(..._ranges: unknown[]) {}
  };

  // eslint-disable-next-line no-eval
  eval(CONTENT_SRC);

  return {
    hlSet,
    hlDelete,
    dispatch: (msg) => msgListeners.forEach((fn) => fn(msg)),
  };
}

// ---------------------------------------------------------------------------

describe("content.js — double-injection guard", () => {
  afterEach(() => {
    document.getElementById("abq-hl-style")?.remove();
  });

  it("second eval is a no-op: style element is created only once", () => {
    runContentScript();
    // eslint-disable-next-line no-eval
    eval(CONTENT_SRC);
    expect(document.querySelectorAll("#abq-hl-style")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("content.js — message listener: abq-apply-highlights", () => {
  afterEach(() => {
    document.getElementById("abq-hl-style")?.remove();
  });

  it("calls CSS.highlights.set with 'abq-hl' when excerpts are found", () => {
    const article = document.createElement("article");
    article.textContent = "The city council voted 5-4 to approve the ordinance.";
    document.body.appendChild(article);

    const { hlSet, dispatch } = runContentScript();
    dispatch({ type: "abq-apply-highlights", excerpts: ["voted 5-4 to approve"] });

    expect(hlSet).toHaveBeenCalledWith("abq-hl", expect.anything());
    article.remove();
  });

  it("does not call CSS.highlights.set when no excerpts match", () => {
    const article = document.createElement("article");
    article.textContent = "Completely unrelated content.";
    document.body.appendChild(article);

    const { hlSet, dispatch } = runContentScript();
    dispatch({ type: "abq-apply-highlights", excerpts: ["voted 5-4 to approve"] });

    const hlCalls = hlSet.mock.calls.filter(([name]: [string]) => name === "abq-hl");
    expect(hlCalls).toHaveLength(0);
    article.remove();
  });
});

// ---------------------------------------------------------------------------

describe("content.js — message listener: abq-clear-highlights", () => {
  afterEach(() => {
    document.getElementById("abq-hl-style")?.remove();
  });

  it("deletes both abq-hl and abq-active highlight registrations", () => {
    const { hlDelete, dispatch } = runContentScript();
    dispatch({ type: "abq-clear-highlights" });

    expect(hlDelete).toHaveBeenCalledWith("abq-hl");
    expect(hlDelete).toHaveBeenCalledWith("abq-active");
  });
});

// ---------------------------------------------------------------------------

describe("content.js — message listener: abq-pulse", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom does not implement scrollIntoView — stub it
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.getElementById("abq-hl-style")?.remove();
  });

  it("sets abq-active highlight and restores abq-hl after 1.2 s", () => {
    const article = document.createElement("article");
    article.textContent = "The council voted on the measure.";
    document.body.appendChild(article);

    const { hlSet, hlDelete, dispatch } = runContentScript();

    // First apply highlights so hlRanges[0] is populated
    dispatch({ type: "abq-apply-highlights", excerpts: ["council voted"] });

    hlSet.mockClear();
    hlDelete.mockClear();

    // Pulse index 0
    dispatch({ type: "abq-pulse", index: 0 });

    // Immediately: abq-hl deleted, abq-active set
    expect(hlDelete).toHaveBeenCalledWith("abq-hl");
    expect(hlSet).toHaveBeenCalledWith("abq-active", expect.anything());

    // After 1.2 s: abq-active deleted, abq-hl restored
    vi.advanceTimersByTime(1200);
    expect(hlDelete).toHaveBeenCalledWith("abq-active");
    expect(hlSet).toHaveBeenCalledWith("abq-hl", expect.anything());

    article.remove();
  });

  it("calls scrollIntoView on the matched element's parent", () => {
    const p = document.createElement("p");
    p.textContent = "The council voted on the measure.";
    document.body.appendChild(p);

    const { dispatch } = runContentScript();
    dispatch({ type: "abq-apply-highlights", excerpts: ["council voted"] });
    dispatch({ type: "abq-pulse", index: 0 });

    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();

    p.remove();
  });

  it("does not call scrollIntoView when the range is null (excerpt not found)", () => {
    const p = document.createElement("p");
    p.textContent = "Completely unrelated content.";
    document.body.appendChild(p);

    const { dispatch } = runContentScript();
    dispatch({ type: "abq-apply-highlights", excerpts: ["council voted"] });
    dispatch({ type: "abq-pulse", index: 0 });

    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();

    p.remove();
  });
});

// ---------------------------------------------------------------------------

describe("content.js — findTextRange: skips non-rendering elements", () => {
  afterEach(() => {
    document.getElementById("abq-hl-style")?.remove();
  });

  it("does not match text inside a <script> element", () => {
    const script = document.createElement("script");
    script.type = "application/ld+json"; // mirrors news-site structured data
    script.textContent = "The council voted on the measure.";
    document.body.appendChild(script);

    const { hlSet, dispatch } = runContentScript();
    dispatch({ type: "abq-apply-highlights", excerpts: ["council voted"] });

    const hlCalls = hlSet.mock.calls.filter(([name]: [string]) => name === "abq-hl");
    expect(hlCalls).toHaveLength(0);

    script.remove();
  });

  it("finds visible text even when a <script> contains the same text first in DOM order", () => {
    // script comes before the visible <p> in DOM order — old code matched the script first
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = "The council voted on the measure.";
    document.body.appendChild(script);

    const p = document.createElement("p");
    p.textContent = "The council voted on the measure.";
    document.body.appendChild(p);

    const { hlSet, dispatch } = runContentScript();
    dispatch({ type: "abq-apply-highlights", excerpts: ["council voted"] });

    expect(hlSet).toHaveBeenCalledWith("abq-hl", expect.anything());

    script.remove();
    p.remove();
  });

  it("does not match text inside a <style> element", () => {
    const style = document.createElement("style");
    style.textContent = "/* council voted */";
    document.body.appendChild(style);

    const { hlSet, dispatch } = runContentScript();
    dispatch({ type: "abq-apply-highlights", excerpts: ["council voted"] });

    const hlCalls = hlSet.mock.calls.filter(([name]: [string]) => name === "abq-hl");
    expect(hlCalls).toHaveLength(0);

    style.remove();
  });
});

describe("content.js — findTextRange (via abq-apply-highlights)", () => {
  afterEach(() => {
    document.getElementById("abq-hl-style")?.remove();
  });

  function setupWithArticle(articleText: string, excerpt: string) {
    const article = document.createElement("article");
    article.textContent = articleText;
    document.body.appendChild(article);

    const { hlSet, dispatch } = runContentScript();
    dispatch({ type: "abq-apply-highlights", excerpts: [excerpt] });

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
    const { hlSet } = setupWithArticle(
      "The council  voted  to approve.",
      "council voted to approve"
    );
    expect(hlSet).toHaveBeenCalledWith("abq-hl", expect.anything());
  });

  it("pass 3 (unicode-normalised): matches when article uses smart quotes, excerpt uses straight", () => {
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
    const calls = hlSet.mock.calls.filter(([name]: [string]) => name === "abq-hl");
    expect(calls).toHaveLength(0);
  });
});
