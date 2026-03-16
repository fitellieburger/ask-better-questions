// side_panel.js — Ask Better Questions Chrome Extension
// Persistent side panel: fetches analysis directly, delegates highlights to content.js via background.

// ── DOM refs ──────────────────────────────────────────────────────────────
const warmupEl      = document.getElementById("warmup");
const wuFill        = document.getElementById("wu-fill");
const wuStatus      = document.getElementById("wu-status");
const tickerPanel   = document.getElementById("ticker-panel");
const notArticleEl  = document.getElementById("not-article");
const barRow        = warmupEl.querySelector(".wu-bar-row");

const mainEl        = document.getElementById("main");
const statusInline  = document.getElementById("status-inline");
const refreshBtn    = document.getElementById("refresh-btn");
const errorEl       = document.getElementById("error");
const choicePanel   = document.getElementById("choice-panel");
const candidateList = document.getElementById("candidate-list");
const resultsEl     = document.getElementById("results");
const itemsEl       = document.getElementById("items");
const tabs          = document.querySelectorAll(".tab");

// ── State ─────────────────────────────────────────────────────────────────
let bundle       = null;
let currentTab   = "fast";
let currentTabId = null;  // tab ID we most recently analyzed (for highlight relay)

// ── Warmup ticker ──────────────────────────────────────────────────────────
const SLIDES = [
  `<h1 class="brand-headline"><span class="brand-ask">Ask</span><span class="brand-rest">Better Questions</span></h1>`,
  `<h1 class="brand-headline"><span class="brand-rest">Read with </span><span class="brand-ask">Intent</span></h1>`,
  `<h1 class="brand-headline"><span class="brand-rest">What do you </span><span class="brand-ask">hope to see?</span></h1>`,
  `<h1 class="brand-headline"><span class="brand-ask">Question </span><span class="brand-rest">the author</span></h1>`,
  `<h1 class="brand-headline"><span class="brand-rest">Is it </span><span class="brand-ask">heat,</span><span class="brand-rest"> or just </span><span class="brand-ask">hot air?</span></h1>`,
  `<h1 class="brand-headline"><span class="brand-rest">Don't get </span><span class="brand-ask">caught</span><span class="brand-rest"> in someone else's </span><span class="brand-ask">emotion.</span></h1>`,
  `<h1 class="brand-headline"><span class="brand-rest">Look for </span><span class="brand-ask">signals</span><span class="brand-rest"> in the text.</span></h1>`,
  `<h1 class="brand-headline"><span class="brand-ask">Notice</span><span class="brand-rest"> what's missing.</span></h1>`,
  `<h1 class="brand-headline"><span class="brand-ask">Pause</span><span class="brand-rest"> before you react.</span></h1>`,
  `<h1 class="brand-headline"><span class="brand-rest">Who benefits from </span><span class="brand-ask">believing</span><span class="brand-rest"> this?</span></h1>`,
  `<h1 class="brand-headline"><span class="brand-rest">What's the </span><span class="brand-ask">claim?</span><span class="brand-rest"> What's the proof?</span></h1>`,
  `<h1 class="brand-headline"><span class="brand-rest">Strong feeling?</span><span class="brand-ask"> Slow down.</span></h1>`,
  `<h1 class="brand-headline"><span class="brand-rest">Urgency is a </span><span class="brand-ask">signal,</span><span class="brand-rest"> not a command.</span></h1>`,
  `<h1 class="brand-headline"><span class="brand-rest">If it wants you angry,</span><span class="brand-ask"> ask why.</span></h1>`,
  `<h1 class="brand-headline"><span class="brand-ask">Loud</span><span class="brand-rest"> doesn't mean true.</span></h1>`,
  `<h1 class="brand-headline"><span class="brand-rest">Are you learning—</span><span class="brand-ask">or just nodding?</span></h1>`,
  `<h1 class="brand-headline"><span class="brand-rest">Does this make sense—</span><span class="brand-ask">or just feel good?</span></h1>`,
];

let slideIdx       = 0;
let lastSlideIdx   = -1;
let tickerInterval = null;

function showSlide(html) {
  tickerPanel.classList.remove("settle-in");
  void tickerPanel.offsetWidth;
  tickerPanel.innerHTML = html;
  tickerPanel.classList.add("settle-in");
}

function nextSlide() {
  let idx = slideIdx % SLIDES.length;
  if (idx === lastSlideIdx) idx = (idx + 1) % SLIDES.length;
  lastSlideIdx = idx;
  slideIdx++;
  showSlide(SLIDES[idx]);
}

function startTicker() {
  showSlide(SLIDES[0]);
  slideIdx = 1;
  setTimeout(nextSlide, 2600);
  tickerInterval = setInterval(nextSlide, 5200);
}

function stopTicker() {
  if (tickerInterval) { clearInterval(tickerInterval); tickerInterval = null; }
}

// ── Warmup loading bar ─────────────────────────────────────────────────────
let barPct        = 0;
let barInterval   = null;
const BAR_STEP    = 5;
const BAR_CAP     = 90;
const BAR_TICK_MS = 700;

function startBar() {
  barInterval = setInterval(() => {
    barPct = Math.min(BAR_CAP, barPct + BAR_STEP);
    wuFill.style.width = barPct + "%";
  }, BAR_TICK_MS);
}

function stopBar() {
  if (barInterval) { clearInterval(barInterval); barInterval = null; }
}

// ── Warmup → results transition ────────────────────────────────────────────
function hideWarmup() {
  stopTicker();
  stopBar();
  wuFill.style.width = "100%";
  warmupEl.style.opacity = "0";
  warmupEl.style.pointerEvents = "none";
  mainEl.classList.remove("hidden");
  setTimeout(() => { warmupEl.style.display = "none"; }, 420);
}

// Restore the warmup overlay to its initial visible state.
function showWarmup() {
  warmupEl.style.display = "";
  warmupEl.style.opacity = "1";
  warmupEl.style.pointerEvents = "";
  barRow.style.display = "";
  wuStatus.style.display = "";
  hide(notArticleEl);
  tickerPanel.innerHTML = "";
  wuFill.style.width = "0%";
  barPct = 0;
  mainEl.classList.add("hidden");
  hide(errorEl);
  hide(choicePanel);
  hide(resultsEl);
  hide(statusInline);
  startTicker();
  startBar();
}

// ── Helpers ───────────────────────────────────────────────────────────────
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function setStage(msg) {
  wuStatus.textContent = msg;
  statusInline.textContent = msg;
  show(statusInline);
}

function showError(msg) {
  hideWarmup();
  errorEl.textContent = msg;
  show(errorEl);
}

function escHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Reset state ────────────────────────────────────────────────────────────

/**
 * Resets all state and UI back to the warmup overlay, ready for a new analysis.
 * Clears any highlights on the previous tab before resetting.
 */
function reset() {
  if (currentTabId !== null) {
    chrome.runtime.sendMessage({ type: "clear-highlights", tabId: currentTabId }).catch(() => {});
  }
  bundle     = null;
  currentTab = "fast";
  tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === "fast"));
  showWarmup();
}

// ── Item rendering (accordion with excerpt snap) ───────────────────────────

/**
 * Renders items with the accordion card style:
 * - `›` arrow toggles the "Why this:" explanation
 * - card body click pulses the excerpt highlight in the article tab
 *
 * @param {Array<{label, text, why, excerpt?}>} items
 */
function renderItems(items) {
  itemsEl.innerHTML = "";
  items.forEach((item, itemIdx) => {
    const li = document.createElement("li");
    li.classList.add("abq-item");
    li.innerHTML = `
      <div class="item-body">
        <div class="item-left">
          <span class="item-label label-${item.label}">${item.label}</span>
          <button class="item-toggle" title="Why this">›</button>
        </div>
        <span class="item-text">${escHtml(item.text)}</span>
      </div>
      <p class="item-why">${escHtml(item.why)}</p>
    `;
    const bodyEl = li.querySelector(".item-body");
    bodyEl.addEventListener("click", (e) => {
      if (e.target.closest(".item-toggle")) {
        li.classList.toggle("open");
        return;
      }
      if (item.excerpt && currentTabId !== null) {
        chrome.runtime.sendMessage({
          type: "pulse-highlight",
          tabId: currentTabId,
          index: itemIdx,
        }).catch(() => {});
      }
    });
    if (item.excerpt && currentTabId !== null) {
      bodyEl.style.cursor = "pointer";
    }
    itemsEl.appendChild(li);
  });
}

/**
 * Handles a successful result: stores bundle, renders items, applies highlights.
 */
function showResults(data) {
  if (data.mode === "bundle") {
    bundle = data.bundle;
  } else {
    bundle = { [data.mode]: data.items };
    currentTab = data.mode;
  }

  renderItems(bundle[currentTab] ?? bundle[Object.keys(bundle)[0]]);

  // Send all excerpts to background → content.js for highlight application
  const allItems = bundle[currentTab] ?? bundle[Object.keys(bundle)[0]];
  const excerpts = allItems.map(it => it.excerpt ?? null);
  if (currentTabId !== null) {
    chrome.runtime.sendMessage({ type: "apply-highlights", tabId: currentTabId, excerpts }).catch(() => {});
  }

  hideWarmup();
  hide(statusInline);
  hide(choicePanel);
  show(resultsEl);
}

// ── Tab switching ──────────────────────────────────────────────────────────
tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    if (!bundle) return;
    const key = tab.dataset.tab;
    if (!bundle[key]) return;
    currentTab = key;
    tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === key));
    renderItems(bundle[key]);
    // Re-apply highlights for the new tab's excerpts
    const excerpts = bundle[key].map(it => it.excerpt ?? null);
    if (currentTabId !== null) {
      chrome.runtime.sendMessage({ type: "apply-highlights", tabId: currentTabId, excerpts }).catch(() => {});
    }
  });
});

// ── NDJSON stream consumer ─────────────────────────────────────────────────
async function runAnalysis(url, chosenUrl) {
  setStage("Fetching page…");

  const body = {
    inputMode: "url",
    url,
    mode: "bundle",
    ...(chosenUrl ? { chosenUrl } : {}),
  };

  let resp;
  try {
    resp = await fetch(CONFIG.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    showError("Could not reach the API. Check your connection.");
    return;
  }

  if (!resp.ok) {
    showError(`API error ${resp.status}.`);
    return;
  }

  const reader  = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = "";

  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }

      if (event.type === "progress") {
        if (event.stage !== "__alive__") setStage(event.stage);

      } else if (event.type === "result") {
        showResults(event.data);
        break outer;

      } else if (event.type === "choice") {
        hideWarmup();
        candidateList.innerHTML = "";
        const sourceUrl = event.data.sourceUrl;
        for (const c of event.data.candidates) {
          const li  = document.createElement("li");
          const btn = document.createElement("button");
          btn.textContent = c.title || c.url;
          btn.title = c.url;
          btn.addEventListener("click", () => {
            hide(choicePanel);
            showWarmup();
            setStage("Fetching article…");
            runAnalysis(sourceUrl, c.url);
          });
          li.appendChild(btn);
          candidateList.appendChild(li);
        }
        show(choicePanel);
        break outer;

      } else if (event.type === "error") {
        showError(event.error + (event.detail ? ` — ${event.detail}` : ""));
        break outer;
      }
    }
  }
}

// ── Smart page detection ───────────────────────────────────────────────────

/**
 * Returns a string describing the non-article page type, or null if the URL
 * looks like a regular article.
 * @param {string} url
 * @returns {string|null}
 */
function detectNonArticle(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host   = u.hostname.replace(/^www\./, "");
  const path   = u.pathname;
  const search = u.search;

  const social = ["twitter.com","x.com","instagram.com","reddit.com",
                  "facebook.com","tiktok.com","linkedin.com"];
  if (social.includes(host)) return "a social feed";

  if (/[?&](q|search|query)=/.test(search) || /\/search(\/|$)/.test(path))
    return "a search results page";

  if (/\/recipes?\//.test(path) || host === "cooking.nytimes.com") return "a recipe page";

  if (!path.replace(/\/$/, "")) return "a homepage";

  return null;
}

/**
 * Shows the non-article detection state inside the warmup overlay.
 * Hides the loading bar and replaces the ticker with a message + "Analyze anyway" button.
 * @param {string} pageType - Human-readable page type, e.g. "a social feed"
 * @param {string} url - The URL to analyze if the user overrides
 */
function showNotArticle(pageType, url) {
  stopTicker();
  stopBar();
  tickerPanel.innerHTML = "";
  barRow.style.display  = "none";
  wuStatus.style.display = "none";

  notArticleEl.innerHTML = `
    <p class="na-label">This looks like ${escHtml(pageType)}.</p>
    <p class="na-hint">Ask Better Questions works best on news and long-form articles.</p>
    <button class="na-btn" id="analyze-anyway">Analyze anyway</button>
  `;
  show(notArticleEl);

  document.getElementById("analyze-anyway").addEventListener("click", () => {
    hide(notArticleEl);
    barRow.style.display   = "";
    wuStatus.style.display = "";
    startTicker();
    startBar();
    runAnalysis(url, null);
  });
}

// ── Refresh button ─────────────────────────────────────────────────────────
refreshBtn.addEventListener("click", async () => {
  reset();
  const { url, tabId } = await getActiveTab();
  currentTabId = tabId;
  if (!url || !/^https?:\/\//.test(url)) {
    showError("Navigate to a web article first, then click ↻.");
    return;
  }
  const nonArticleType = detectNonArticle(url);
  if (nonArticleType) {
    stopTicker();
    stopBar();
    showNotArticle(nonArticleType, url);
  } else {
    runAnalysis(url, null);
  }
});

// ── Tab-change notification from background ────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "tab-changed" && bundle) {
    // Show a subtle nudge in the inline status
    statusInline.textContent = "Page changed — click ↻ to analyze";
    show(statusInline);
  }
});

// ── URL acquisition ────────────────────────────────────────────────────────

/**
 * Asks background.js for the active tab's URL and tab ID.
 * @returns {Promise<{url: string|null, tabId: number|null}>}
 */
function getActiveTab() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "get-tab-url" }, (response) => {
      resolve(response ?? { url: null, tabId: null });
    });
  });
}

// ── Service wake-up ────────────────────────────────────────────────────────

/**
 * Pings both Render health endpoints and waits for both to respond before
 * returning. Shows "Waking up server…" if either takes more than 3 s.
 * Always resolves — if a service is truly unreachable the analysis request
 * will surface the error directly.
 */
async function wakeServices() {
  const slowTimer = setTimeout(() => setStage("Waking up server\u2026"), 3000);
  try {
    await Promise.all([
      fetch("https://ask-better-questions.onrender.com/api/health",
            { signal: AbortSignal.timeout(60_000) }),
      fetch("https://ask-better-questions-vrjh.onrender.com/health",
            { signal: AbortSignal.timeout(60_000) }),
    ]);
  } catch { /* proceed — analysis will surface any real error */ }
  finally { clearTimeout(slowTimer); }
}

// ── Entry point ────────────────────────────────────────────────────────────
(async () => {
  startTicker();
  startBar();

  const { url, tabId } = await getActiveTab();
  currentTabId = tabId;

  if (!url || !/^https?:\/\//.test(url)) {
    showError("Navigate to a web article, then click ↻ to analyze it.");
    return;
  }

  await wakeServices();

  const nonArticleType = detectNonArticle(url);
  if (nonArticleType) {
    stopTicker();
    stopBar();
    showNotArticle(nonArticleType, url);
  } else {
    await runAnalysis(url, null);
  }
})();
