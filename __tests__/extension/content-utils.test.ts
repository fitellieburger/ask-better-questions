/**
 * Unit tests for the pure utility functions defined inside content.js.
 *
 * Because content.js is an IIFE script (not a module), these functions cannot
 * be imported directly. This file re-declares them verbatim and tests their
 * specification. Any divergence from the production code is a signal to update
 * both here and in content.js.
 *
 * Functions tested: escHtml · normPunct · buildCompact
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Functions mirrored from content.js
// ---------------------------------------------------------------------------

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normPunct(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ");
}

function buildCompact(str: string): { out: string; map: number[] } {
  const map: number[] = [];
  let out = "";
  let prevWS = false;
  for (let i = 0; i < str.length; i++) {
    if (/\s/.test(str[i])) {
      if (!prevWS) {
        out += " ";
        map.push(i);
      }
      prevWS = true;
    } else {
      out += str[i];
      map.push(i);
      prevWS = false;
    }
  }
  return { out, map };
}

// ---------------------------------------------------------------------------
// escHtml
// ---------------------------------------------------------------------------

describe("escHtml", () => {
  it("escapes ampersands", () => {
    expect(escHtml("a&b")).toBe("a&amp;b");
  });

  it("escapes less-than signs", () => {
    expect(escHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes greater-than signs", () => {
    expect(escHtml("a > b")).toBe("a &gt; b");
  });

  it("escapes double quotes", () => {
    expect(escHtml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("escapes all four special characters in one string", () => {
    expect(escHtml('<a href="x&y">z > w</a>')).toBe(
      "&lt;a href=&quot;x&amp;y&quot;&gt;z &gt; w&lt;/a&gt;"
    );
  });

  it("leaves plain text unchanged", () => {
    expect(escHtml("hello world")).toBe("hello world");
  });

  it("handles an empty string", () => {
    expect(escHtml("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// normPunct
// ---------------------------------------------------------------------------

describe("normPunct", () => {
  it("converts left and right single curly quotes to straight single quote", () => {
    expect(normPunct("\u2018don\u2019t")).toBe("'don't");
  });

  it("converts left and right double curly quotes to straight double quote", () => {
    expect(normPunct("\u201CHello\u201D")).toBe('"Hello"');
  });

  it("converts en-dash to hyphen", () => {
    expect(normPunct("5\u20134")).toBe("5-4");
  });

  it("converts em-dash to hyphen", () => {
    expect(normPunct("word\u2014word")).toBe("word-word");
  });

  it("converts horizontal bar to hyphen", () => {
    expect(normPunct("a\u2015b")).toBe("a-b");
  });

  it("converts ellipsis character to three dots", () => {
    expect(normPunct("wait\u2026")).toBe("wait...");
  });

  it("converts non-breaking space to regular space", () => {
    expect(normPunct("a\u00A0b")).toBe("a b");
  });

  it("collapses multiple whitespace characters into one space", () => {
    expect(normPunct("a  b\t\tc")).toBe("a b c");
  });

  it("leaves plain ASCII text unchanged", () => {
    expect(normPunct("hello world")).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// buildCompact
// ---------------------------------------------------------------------------

describe("buildCompact", () => {
  it("returns the same string when there is no whitespace to collapse", () => {
    const { out } = buildCompact("hello");
    expect(out).toBe("hello");
  });

  it("collapses a run of spaces into a single space", () => {
    const { out } = buildCompact("a   b");
    expect(out).toBe("a b");
  });

  it("collapses tabs and newlines into a single space", () => {
    const { out } = buildCompact("a\t\nb");
    expect(out).toBe("a b");
  });

  it("map length equals compacted string length", () => {
    const { out, map } = buildCompact("a  b c");
    expect(map.length).toBe(out.length);
  });

  it("map[0] points to the original index of the first non-space character", () => {
    const { map } = buildCompact("abc");
    expect(map[0]).toBe(0);
    expect(map[1]).toBe(1);
    expect(map[2]).toBe(2);
  });

  it("map correctly tracks original positions through collapsed whitespace", () => {
    // "a  b" → compact "a b": map[0]=0 (a), map[1]=1 (first space), map[2]=3 (b)
    const { out, map } = buildCompact("a  b");
    expect(out).toBe("a b");
    expect(map[0]).toBe(0); // 'a'
    expect(map[1]).toBe(1); // first ' '
    expect(map[2]).toBe(3); // 'b'
  });

  it("handles a string of only whitespace (compacts to single space)", () => {
    const { out } = buildCompact("   ");
    expect(out).toBe(" ");
  });

  it("handles an empty string", () => {
    const { out, map } = buildCompact("");
    expect(out).toBe("");
    expect(map).toHaveLength(0);
  });
});
