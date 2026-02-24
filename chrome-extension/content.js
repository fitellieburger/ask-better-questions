// content.js — Ask Better Questions Chrome Extension
// Self-contained: injected into the current tab via chrome.scripting.executeScript.
// Uses Shadow DOM so extension styles are fully isolated from the host page.

(function () {
  // ── Guard: prevent double-injection ──────────────────────────────────────
  if (document.getElementById("abq-host")) return;

  // ── CSS Custom Highlights (non-destructive in-page text marking) ──────────
  const supportsHighlight = typeof CSS !== "undefined" && !!CSS.highlights;
  if (supportsHighlight) {
    const hlStyle = document.createElement("style");
    hlStyle.id = "abq-hl-style";
    hlStyle.textContent = `
      ::highlight(abq-hl)     { background-color: rgba(255,215,0,0.22); }
      ::highlight(abq-active) { background-color: rgba(255,215,0,0.65); }
    `;
    document.head.appendChild(hlStyle);
  }

  // ── Panel sizing ──────────────────────────────────────────────────────────
  const isMobile    = window.innerWidth < 768;
  const panelHeight = Math.floor(window.innerHeight * (isMobile ? 0.5 : 1 / 3));

  // ── Host element (pushes page content down) ───────────────────────────────
  const host = document.createElement("div");
  host.id = "abq-host";
  host.dataset.savedPaddingTop = document.body.style.paddingTop ?? "";
  Object.assign(host.style, {
    position:  "fixed",
    top:       "0",
    left:      "0",
    width:     "100%",
    height:    panelHeight + "px",
    zIndex:    "2147483647",
    boxSizing: "border-box",
  });
  document.body.prepend(host);
  document.body.style.paddingTop = panelHeight + "px";

  // ── Shadow DOM ────────────────────────────────────────────────────────────
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
<style>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,700;1,500;1,600&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:host {
  display: block;
  width: 100%;
  height: 100%;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 13px;
  line-height: 1.5;
}

/* ── Tokens ── */
:host {
  --serif:        "Playfair Display", Georgia, serif;
  --sans:         ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --slate-bg:     #1f2933;
  --slate-text:   #f5f7fa;
  --slate-muted:  rgba(245,247,250,0.72);
  --brand-yellow: rgba(255,215,0,0.82);
  --bg:           #0f0f10;
  --fg:           #f2f2f2;
  --card:         #17181a;
  --border:       rgba(255,255,255,0.12);
  --muted:        rgba(255,255,255,0.60);
  --yellow:       #FFD700;
  --radius:       10px;
}

.hidden { display: none !important; }

/* ── Close button ── */
#abq-close {
  position: absolute;
  top: 10px;
  right: 14px;
  background: none;
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 50%;
  width: 26px;
  height: 26px;
  color: rgba(255,255,255,0.6);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  transition: border-color 0.15s, color 0.15s;
}
#abq-close:hover { border-color: #FFD700; color: #FFD700; }

/* =====================================================
   WARMUP
   ===================================================== */

#abq-warmup {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1200px 700px at 20% 0%, rgba(255,255,255,0.06), transparent 55%),
    radial-gradient(900px 600px at 80% 20%, rgba(255,255,255,0.05), transparent 55%),
    var(--slate-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  transition: opacity 0.4s ease;
}

@media (max-width: 720px) {
  #abq-warmup { align-items: flex-end; padding: 0 16px 22px; }
}

.wu-shell { width: min(980px, 100%); }

.wu-ticker {
  min-height: calc(2.4em * 1.06);
  display: grid;
  align-content: end;
}

.ticker-panel { color: var(--slate-text); }

.ticker-panel h1 {
  margin: 0;
  line-height: 1.06;
  overflow-wrap: anywhere;
  word-break: normal;
  text-wrap: balance;
  letter-spacing: -0.012em;
}

.brand-ask {
  font-family: var(--serif);
  font-style: italic;
  font-weight: 500;
  font-size: clamp(2.4rem, 5.5vw, 4.2rem);
  letter-spacing: -0.015em;
  color: var(--brand-yellow);
  display: inline;
  line-height: 0.7;
}

.brand-rest {
  font-family: var(--sans);
  font-size: clamp(1.1rem, 2.0vw, 1.7rem);
  font-weight: 750;
  letter-spacing: -0.01em;
  opacity: 0.92;
  margin-left: 8px;
  color: var(--slate-text);
}

.settle-in {
  animation: settleIn 700ms cubic-bezier(.16,1,.3,1) both;
}
@keyframes settleIn {
  from { opacity:0; transform:translateY(10px); filter:blur(6px); }
  to   { opacity:1; transform:translateY(0);    filter:blur(0);   }
}
@media (prefers-reduced-motion: reduce) { .settle-in { animation: none; } }

.wu-bar-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  width: min(640px, 100%);
  padding: 0 22px;
}

.wu-bar-label {
  font-family: var(--sans);
  font-weight: 800;
  font-size: 0.85rem;
  letter-spacing: 0.01em;
  color: var(--slate-text);
  white-space: nowrap;
}

.wu-bar-track {
  position: relative;
  flex: 1;
  height: 10px;
  border-radius: 999px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.16);
  background: rgba(255,255,255,0.07);
  min-width: 120px;
}

.wu-fill {
  height: 100%;
  width: 0%;
  border-radius: 999px;
  transition: width 420ms cubic-bezier(.22,.9,.25,1);
  background: linear-gradient(to right, rgba(255,215,0,0.18), rgba(255,215,0,0.86));
}

.wu-shimmer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.22), rgba(255,255,255,0));
  animation: wuShimmer 1.12s linear infinite;
  mix-blend-mode: screen;
}
@keyframes wuShimmer {
  0%   { transform: translateX(-70%); }
  100% { transform: translateX(70%); }
}

.wu-status {
  margin-top: 10px;
  padding: 0 22px;
  font-size: 11px;
  color: var(--slate-muted);
}

/* =====================================================
   MAIN (results)
   ===================================================== */

#abq-main {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--fg);
  overflow-y: auto;
}

header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.logo {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--yellow);
  flex: 1;
}

.status-inline { font-size: 11px; color: var(--muted); }

.error {
  padding: 16px;
  color: #ff6b6b;
  font-size: 13px;
}

/* Choice */
#abq-choice { padding: 14px 16px; }
.choice-prompt { font-size: 12px; color: var(--muted); margin-bottom: 10px; }
#abq-candidates { list-style: none; display: flex; flex-direction: column; gap: 6px; }
#abq-candidates li button {
  width: 100%;
  text-align: left;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 12px;
  color: var(--fg);
  font-size: 12px;
  font-family: var(--sans);
  cursor: pointer;
  transition: border-color 0.15s;
}
#abq-candidates li button:hover { border-color: var(--yellow); }

/* Tabs */
.abq-tabs {
  display: flex;
  gap: 6px;
  padding: 10px 16px 0;
  flex-shrink: 0;
}
.abq-tab {
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 4px 14px;
  color: var(--muted);
  font-size: 12px;
  font-family: var(--sans);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.abq-tab.active { color: var(--yellow); border-color: var(--yellow); }

/* Items */
#abq-items {
  list-style: none;
  padding: 10px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  overflow-y: auto;
}
#abq-items li {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
}
.item-label {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border-radius: 4px;
  padding: 2px 6px;
  margin-bottom: 5px;
}
.label-Words   { background: rgba(255,215,0,0.15);  color: #FFD700; }
.label-Proof   { background: rgba(80,200,120,0.15); color: #50C878; }
.label-Missing { background: rgba(255,100,80,0.15); color: #FF6450; }
.item-text { font-size: 13px; font-weight: 600; margin-bottom: 4px; color: var(--fg); }
.item-why  { font-size: 11px; color: var(--muted); line-height: 1.4; }

/* Meter */
.abq-meter {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px 12px;
  flex-shrink: 0;
}
.meter-track {
  flex: 1;
  height: 6px;
  background: var(--border);
  border-radius: 99px;
  overflow: hidden;
}
.meter-fill {
  height: 100%;
  background: var(--yellow);
  border-radius: 99px;
  transition: width 0.4s ease;
}
.meter-lbl { font-size: 11px; color: var(--muted); white-space: nowrap; }
</style>

<!-- Close button (always visible) -->
<button id="abq-close" title="Close">✕</button>

<!-- Warmup overlay -->
<div id="abq-warmup">
  <div class="wu-shell">
    <div class="wu-ticker">
      <div id="abq-ticker" class="ticker-panel"></div>
    </div>
    <div class="wu-bar-row">
      <span class="wu-bar-label">Loading</span>
      <div class="wu-bar-track">
        <div id="abq-fill" class="wu-fill"></div>
        <div class="wu-shimmer" aria-hidden="true"></div>
      </div>
    </div>
    <p id="abq-wu-status" class="wu-status">Starting up…</p>
  </div>
</div>

<!-- Results panel -->
<div id="abq-main" class="hidden">
  <header>
    <span class="logo">Ask Better Questions</span>
    <span id="abq-status" class="status-inline"></span>
  </header>
  <div id="abq-error" class="error hidden"></div>
  <div id="abq-choice" class="hidden">
    <p class="choice-prompt">This page has multiple articles. Pick one:</p>
    <ul id="abq-candidates"></ul>
  </div>
  <div id="abq-results" class="hidden">
    <div class="abq-tabs" role="tablist">
      <button class="abq-tab active" data-tab="fast"   role="tab">Fast</button>
      <button class="abq-tab"        data-tab="deeper" role="tab">Deeper</button>
      <button class="abq-tab"        data-tab="cliff"  role="tab">Cliff</button>
    </div>
    <ul id="abq-items"></ul>
    <div id="abq-meter" class="abq-meter hidden">
      <div class="meter-track"><div id="abq-meter-fill" class="meter-fill"></div></div>
      <span id="abq-meter-lbl" class="meter-lbl"></span>
    </div>
  </div>
</div>
`;

  // ── Shadow DOM refs ───────────────────────────────────────────────────────
  const s            = shadow;
  const warmupEl     = s.getElementById("abq-warmup");
  const wuFill       = s.getElementById("abq-fill");
  const wuStatus     = s.getElementById("abq-wu-status");
  const tickerPanel  = s.getElementById("abq-ticker");
  const mainEl       = s.getElementById("abq-main");
  const statusEl     = s.getElementById("abq-status");
  const errorEl      = s.getElementById("abq-error");
  const choiceEl     = s.getElementById("abq-choice");
  const candidatesEl = s.getElementById("abq-candidates");
  const resultsEl    = s.getElementById("abq-results");
  const itemsEl      = s.getElementById("abq-items");
  const meterEl      = s.getElementById("abq-meter");
  const meterFill    = s.getElementById("abq-meter-fill");
  const meterLbl     = s.getElementById("abq-meter-lbl");
  const tabs         = s.querySelectorAll(".abq-tab");

  // Close button
  s.getElementById("abq-close").addEventListener("click", () => {
    clearHighlights();
    document.getElementById("abq-hl-style")?.remove();
    document.body.style.paddingTop = host.dataset.savedPaddingTop ?? "";
    host.remove();
  });

  // ── State ─────────────────────────────────────────────────────────────────
  let bundle     = null;
  let currentTab = "fast";

  // ── Helpers ───────────────────────────────────────────────────────────────
  const show = el => el.classList.remove("hidden");
  const hide = el => el.classList.add("hidden");

  function escHtml(str) {
    return str
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ── Warmup ticker ─────────────────────────────────────────────────────────
  const SLIDES = [
    `<h1><span class="brand-ask">Ask</span><span class="brand-rest">Better Questions</span></h1>`,
    `<h1><span class="brand-rest">Read with </span><span class="brand-ask">Intent</span></h1>`,
    `<h1><span class="brand-rest">What do you </span><span class="brand-ask">hope to see?</span></h1>`,
    `<h1><span class="brand-ask">Question </span><span class="brand-rest">the author</span></h1>`,
    `<h1><span class="brand-rest">Is it </span><span class="brand-ask">heat,</span><span class="brand-rest"> or just </span><span class="brand-ask">hot air?</span></h1>`,
    `<h1><span class="brand-rest">Don't get </span><span class="brand-ask">caught</span><span class="brand-rest"> in someone else's </span><span class="brand-ask">emotion.</span></h1>`,
    `<h1><span class="brand-rest">Look for </span><span class="brand-ask">signals</span><span class="brand-rest"> in the text.</span></h1>`,
    `<h1><span class="brand-ask">Notice</span><span class="brand-rest"> what's missing.</span></h1>`,
    `<h1><span class="brand-ask">Pause</span><span class="brand-rest"> before you react.</span></h1>`,
    `<h1><span class="brand-rest">Who benefits from </span><span class="brand-ask">believing</span><span class="brand-rest"> this?</span></h1>`,
    `<h1><span class="brand-rest">What's the </span><span class="brand-ask">claim?</span><span class="brand-rest"> What's the proof?</span></h1>`,
    `<h1><span class="brand-rest">Strong feeling?</span><span class="brand-ask"> Slow down.</span></h1>`,
    `<h1><span class="brand-rest">Urgency is a </span><span class="brand-ask">signal,</span><span class="brand-rest"> not a command.</span></h1>`,
    `<h1><span class="brand-rest">If it wants you angry,</span><span class="brand-ask"> ask why.</span></h1>`,
    `<h1><span class="brand-ask">Loud</span><span class="brand-rest"> doesn't mean true.</span></h1>`,
    `<h1><span class="brand-rest">Are you learning—</span><span class="brand-ask">or just nodding?</span></h1>`,
    `<h1><span class="brand-rest">Does this make sense—</span><span class="brand-ask">or just feel good?</span></h1>`,
  ];

  let slideIdx = 0;
  let tickerTimer = null;

  function showSlide(html) {
    tickerPanel.classList.remove("settle-in");
    void tickerPanel.offsetWidth; // reflow to restart animation
    tickerPanel.innerHTML = html;
    tickerPanel.classList.add("settle-in");
  }

  function nextSlide() {
    showSlide(SLIDES[slideIdx % SLIDES.length]);
    slideIdx++;
  }

  function startTicker() {
    showSlide(SLIDES[0]);
    slideIdx = 1;
    setTimeout(() => { nextSlide(); tickerTimer = setInterval(nextSlide, 5200); }, 2600);
  }

  function stopTicker() {
    if (tickerTimer) { clearInterval(tickerTimer); tickerTimer = null; }
  }

  // ── Loading bar ───────────────────────────────────────────────────────────
  let barPct = 0;
  let barTimer = null;

  function startBar() {
    barTimer = setInterval(() => {
      barPct = Math.min(90, barPct + 5);
      wuFill.style.width = barPct + "%";
    }, 700);
  }

  function stopBar() {
    if (barTimer) { clearInterval(barTimer); barTimer = null; }
  }

  // ── Warmup → results transition ───────────────────────────────────────────
  function hideWarmup() {
    stopTicker();
    stopBar();
    wuFill.style.width = "100%";
    warmupEl.style.opacity = "0";
    warmupEl.style.pointerEvents = "none";
    show(mainEl);
    setTimeout(() => hide(warmupEl), 420);
  }

  function showWarmup() {
    wuFill.style.width = "0%";
    barPct = 0;
    warmupEl.style.opacity = "1";
    warmupEl.style.pointerEvents = "";
    hide(mainEl);
    show(warmupEl);
    startTicker();
    startBar();
  }

  // ── Fit panel height to content (cap at 50 % of viewport) ────────────────
  // Temporarily collapse the flex-grown items list so mainEl.scrollHeight
  // reflects the true content height rather than the stretched height.
  function fitResultsToContent() {
    requestAnimationFrame(() => {
      itemsEl.style.flex = "none";
      itemsEl.style.overflowY = "visible";

      const natural = mainEl.scrollHeight;

      itemsEl.style.flex = "";
      itemsEl.style.overflowY = "";

      const maxPx = Math.floor(window.innerHeight * 0.5);
      const newH  = Math.min(natural, maxPx);

      host.style.height = newH + "px";
      document.body.style.paddingTop = newH + "px";
    });
  }

  // ── Text-range finder (for CSS Custom Highlights) ─────────────────────────
  // Normalise punctuation so extractor-cleaned text matches live DOM:
  // smart quotes → straight, em/en-dash → hyphen, ellipsis → ..., NBSP → space
  function normPunct(s) {
    return s
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
      .replace(/[\u2013\u2014\u2015]/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ");
  }

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

  function findTextRange(quote) {
    if (!quote || !supportsHighlight) return null;
    const q = quote.replace(/\s+/g, " ").trim();
    if (!q) return null;

    // Walk all text nodes outside the extension panel
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const chars = [];
    let n;
    while ((n = walker.nextNode())) {
      if (host.contains(n)) continue;
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

    // Pass 3: normalise unicode punctuation on both sides, then whitespace-collapse
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

  // ── Highlight state + helpers ─────────────────────────────────────────────
  let hlRanges = []; // parallel to rendered items array

  function applyHighlights(items) {
    if (!supportsHighlight) return;
    CSS.highlights.delete("abq-hl");
    CSS.highlights.delete("abq-active");
    hlRanges = items.map(item => findTextRange(item.quote));
    console.log("[ABQ] quotes:", items.map(i => i.quote));
    console.log("[ABQ] ranges:", hlRanges);
    const valid = hlRanges.filter(Boolean);
    if (valid.length) CSS.highlights.set("abq-hl", new Highlight(...valid));
  }

  function clearHighlights() {
    if (!supportsHighlight) return;
    CSS.highlights.delete("abq-hl");
    CSS.highlights.delete("abq-active");
    hlRanges = [];
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function renderItems(items) {
    itemsEl.innerHTML = "";
    items.forEach((item, itemIdx) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="item-label label-${item.label}">${item.label}</span>
        <p class="item-text">${escHtml(item.text)}</p>
        <p class="item-why">${escHtml(item.why)}</p>
      `;
      if (supportsHighlight && item.quote) {
        li.style.cursor = "pointer";
        li.addEventListener("click", () => {
          const range = hlRanges[itemIdx];
          if (!range) return;
          // Pulse: brighten this range, then restore all dim highlights
          CSS.highlights.delete("abq-hl");
          CSS.highlights.set("abq-active", new Highlight(range));
          range.startContainer.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" });
          setTimeout(() => {
            CSS.highlights.delete("abq-active");
            const valid = hlRanges.filter(Boolean);
            if (valid.length) CSS.highlights.set("abq-hl", new Highlight(...valid));
          }, 1200);
        });
      }
      itemsEl.appendChild(li);
    });
  }

  function renderMeter(meter) {
    if (!meter) { hide(meterEl); return; }
    meterFill.style.width = meter.value + "%";
    meterLbl.textContent  = meter.label;
    show(meterEl);
  }

  function showResults(data) {
    if (data.mode === "bundle") {
      bundle = data.bundle;
    } else {
      bundle = { [data.mode]: data.items };
      currentTab = data.mode;
    }
    const activeItems = bundle[currentTab] ?? bundle[Object.keys(bundle)[0]];
    renderItems(activeItems);
    applyHighlights(activeItems);
    renderMeter(data.meter);
    statusEl.textContent = "";
    hideWarmup();
    hide(choiceEl);
    show(resultsEl);
    fitResultsToContent();
  }

  function showError(msg) {
    hideWarmup();
    errorEl.textContent = msg;
    show(errorEl);
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      if (!bundle) return;
      const key = tab.dataset.tab;
      if (!bundle[key]) return;
      currentTab = key;
      tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === key));
      renderItems(bundle[key]);
      applyHighlights(bundle[key]);
      fitResultsToContent();
    });
  });

  // ── Stream via background service worker ─────────────────────────────────
  // Fetch is done in background.js to avoid mixed-content blocks on HTTPS pages.
  function runAnalysis(url, chosenUrl) {
    wuStatus.textContent = "Fetching page…";
    statusEl.textContent = "Fetching page…";

    const port = chrome.runtime.connect({ name: "abq-analyze" });
    let settled = false;

    port.onDisconnect.addListener(() => {
      if (!settled) showError("Connection lost — please try again.");
    });

    port.onMessage.addListener((event) => {
      if (event.type === "progress") {
        if (event.stage === "__alive__") {
          wuStatus.textContent = "Analyzing…";
          statusEl.textContent = "Analyzing…";
        } else {
          wuStatus.textContent = event.stage;
          statusEl.textContent = event.stage;
        }

      } else if (event.type === "result") {
        settled = true;
        port.disconnect();
        showResults(event.data);

      } else if (event.type === "choice") {
        settled = true;
        port.disconnect();
        hideWarmup();
        candidatesEl.innerHTML = "";
        const sourceUrl = event.data.sourceUrl;
        for (const c of event.data.candidates) {
          const li  = document.createElement("li");
          const btn = document.createElement("button");
          btn.textContent = c.title || c.url;
          btn.title = c.url;
          btn.addEventListener("click", () => {
            hide(choiceEl);
            showWarmup();
            runAnalysis(sourceUrl, c.url);
          });
          li.appendChild(btn);
          candidatesEl.appendChild(li);
        }
        show(choiceEl);

      } else if (event.type === "error") {
        settled = true;
        port.disconnect();
        showError(event.error + (event.detail ? ` — ${event.detail}` : ""));
      }
    });

    port.postMessage({ url, chosenUrl: chosenUrl ?? null });
  }

  // ── Entry ─────────────────────────────────────────────────────────────────
  const pageUrl = window.location.href;

  if (!/^https?:\/\//.test(pageUrl)) {
    showError("Navigate to a web article first.");
    return;
  }

  showWarmup();
  runAnalysis(pageUrl, null);
})();
