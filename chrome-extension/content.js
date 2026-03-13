// content.js — Ask Better Questions Chrome Extension
// Highlights-only: CSS Custom Highlights for excerpt text in the article page.
// Injected on demand by background.js when results are ready.

(function () {
  // ── Guard: prevent double-injection ──────────────────────────────────────
  if (document.getElementById("abq-hl-style")) return;

  // ── CSS Custom Highlights setup ───────────────────────────────────────────
  const supportsHighlight = typeof CSS !== "undefined" && !!CSS.highlights;
  if (!supportsHighlight) return; // nothing to do without API support

  const hlStyle = document.createElement("style");
  hlStyle.id = "abq-hl-style";
  hlStyle.textContent = `
    ::highlight(abq-hl)     { background-color: rgba(255,215,0,0.22); }
    ::highlight(abq-active) { background-color: rgba(255,215,0,0.65); }
  `;
  document.head.appendChild(hlStyle);

  // ── Text normalisation helpers ────────────────────────────────────────────

  /**
   * Normalises Unicode punctuation to ASCII equivalents so that
   * extractor-cleaned text can be matched against live DOM text nodes.
   */
  function normPunct(s) {
    return s
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
      .replace(/[\u2013\u2014\u2015]/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ");
  }

  /**
   * Collapses whitespace runs and builds an index map from compact positions
   * back to original-string positions.
   */
  function buildCompact(str) {
    const map = [];
    let out = "";
    let prevWS = false;
    for (let i = 0; i < str.length; i++) {
      if (/\s/.test(str[i])) {
        if (!prevWS) { out += " "; map.push(i); }
        prevWS = true;
      } else {
        out += str[i];
        map.push(i);
        prevWS = false;
      }
    }
    return { out, map };
  }

  /**
   * Finds the DOM Range for a verbatim excerpt string using three passes:
   *   1. Exact match
   *   2. Whitespace-collapsed match
   *   3. Unicode-normalised + whitespace-collapsed match
   *
   * @param {string} quote - The excerpt text to locate.
   * @returns {Range|null}
   */
  function findTextRange(quote) {
    if (!quote) return null;
    const q = quote.replace(/\s+/g, " ").trim();
    if (!q) return null;

    const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const chars = [];
    let n;
    while ((n = walker.nextNode())) {
      if (n.parentElement && SKIP.has(n.parentElement.tagName)) continue;
      const t = n.textContent;
      for (let i = 0; i < t.length; i++) chars.push({ node: n, offset: i });
    }
    const combined = chars.map(c => c.node.textContent[c.offset]).join("");

    function makeRange(idx, len) {
      const startC = chars[idx];
      const endC   = chars[idx + len - 1];
      if (!startC || !endC) return null;
      const r = document.createRange();
      r.setStart(startC.node, startC.offset);
      r.setEnd(endC.node, endC.offset + 1);
      return r;
    }

    // Pass 1: exact
    let idx = combined.indexOf(q);
    if (idx !== -1) return makeRange(idx, q.length);

    // Pass 2: whitespace-collapsed
    const { out: compact, map: c2o } = buildCompact(combined);
    let ci = compact.indexOf(q);
    if (ci !== -1) {
      idx = c2o[ci];
      const len = c2o[Math.min(ci + q.length - 1, c2o.length - 1)] - idx + 1;
      return makeRange(idx, len);
    }

    // Pass 3: unicode-normalised + whitespace-collapsed
    const qn = normPunct(q);
    const combNorm = normPunct(combined);
    const { out: compactN, map: cn2o } = buildCompact(combNorm);
    ci = compactN.indexOf(qn);
    if (ci !== -1) {
      idx = cn2o[ci];
      const len = cn2o[Math.min(ci + qn.length - 1, cn2o.length - 1)] - idx + 1;
      return makeRange(idx, len);
    }

    return null;
  }

  // ── Highlight state ───────────────────────────────────────────────────────
  let hlRanges = []; // parallel to the excerpts array

  /**
   * Applies CSS Custom Highlights for an array of excerpt strings.
   * @param {string[]} excerpts
   */
  function applyHighlights(excerpts) {
    CSS.highlights.delete("abq-hl");
    CSS.highlights.delete("abq-active");
    hlRanges = excerpts.map(findTextRange);
    const valid = hlRanges.filter(Boolean);
    if (valid.length) CSS.highlights.set("abq-hl", new Highlight(...valid));
  }

  /** Removes all registered highlights. */
  function clearHighlights() {
    CSS.highlights.delete("abq-hl");
    CSS.highlights.delete("abq-active");
    hlRanges = [];
  }

  /**
   * Pulses a single excerpt highlight (brightens it, scrolls to it, then dims).
   * @param {number} index - Index into the hlRanges array.
   */
  function pulseHighlight(index) {
    const range = hlRanges[index];
    if (!range) return;
    CSS.highlights.delete("abq-hl");
    CSS.highlights.set("abq-active", new Highlight(range));
    range.startContainer.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
      CSS.highlights.delete("abq-active");
      const valid = hlRanges.filter(Boolean);
      if (valid.length) CSS.highlights.set("abq-hl", new Highlight(...valid));
    }, 1200);
  }

  // ── Message listener ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "abq-apply-highlights") applyHighlights(msg.excerpts);
    if (msg.type === "abq-clear-highlights") clearHighlights();
    if (msg.type === "abq-pulse") pulseHighlight(msg.index);
  });
})();
