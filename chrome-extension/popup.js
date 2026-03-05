// popup.js — Ask Better Questions Chrome Extension

// ── DOM refs ──────────────────────────────────────────────────────────────
const warmupEl      = document.getElementById("warmup");
const wuFill        = document.getElementById("wu-fill");
const wuStatus      = document.getElementById("wu-status");
const tickerPanel   = document.getElementById("ticker-panel");

const mainEl        = document.getElementById("main");
const statusInline  = document.getElementById("status-inline");
const errorEl       = document.getElementById("error");
const choicePanel   = document.getElementById("choice-panel");
const candidateList = document.getElementById("candidate-list");
const resultsEl     = document.getElementById("results");
const itemsEl       = document.getElementById("items");
const tabs          = document.querySelectorAll(".tab");

// ── State ─────────────────────────────────────────────────────────────────
let bundle     = null;
let currentTab = "fast";

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

/**
 * Displays a single warmup ticker slide with a settle-in animation.
 * Forces a reflow between removing and re-adding the animation class so
 * the CSS animation restarts cleanly on each slide change.
 *
 * @param {string} html - The HTML string for the slide (trusted static content).
 */
function showSlide(html) {
  tickerPanel.classList.remove("settle-in");
  // Trigger reflow to restart animation
  void tickerPanel.offsetWidth;
  tickerPanel.innerHTML = html;
  tickerPanel.classList.add("settle-in");
}

/**
 * Advances the ticker to the next slide, skipping any slide that was just shown
 * to avoid back-to-back repeats.
 */
function nextSlide() {
  let idx = slideIdx % SLIDES.length;
  if (idx === lastSlideIdx) idx = (idx + 1) % SLIDES.length;
  lastSlideIdx = idx;
  slideIdx++;
  showSlide(SLIDES[idx]);
}

/**
 * Starts the warmup ticker: shows the first slide immediately, then advances
 * every 5.2 seconds after a 2.6-second initial delay.
 */
function startTicker() {
  showSlide(SLIDES[0]);
  slideIdx = 1;
  setTimeout(nextSlide, 2600);
  tickerInterval = setInterval(nextSlide, 5200);
}

/**
 * Stops the warmup ticker interval and clears the timer reference.
 */
function stopTicker() {
  if (tickerInterval) { clearInterval(tickerInterval); tickerInterval = null; }
}

// ── Warmup loading bar ─────────────────────────────────────────────────────

let barPct         = 0;
let barInterval    = null;
const BAR_STEP     = 5;
const BAR_CAP      = 90;
const BAR_TICK_MS  = 700;

/**
 * Starts the loading bar animation, incrementing fill by BAR_STEP percent
 * every BAR_TICK_MS milliseconds up to BAR_CAP (90%).
 * The final 10% is filled when `hideWarmup` completes the bar to 100%.
 */
function startBar() {
  barInterval = setInterval(() => {
    barPct = Math.min(BAR_CAP, barPct + BAR_STEP);
    wuFill.style.width = barPct + "%";
  }, BAR_TICK_MS);
}

/**
 * Stops the loading bar interval and clears the timer reference.
 */
function stopBar() {
  if (barInterval) { clearInterval(barInterval); barInterval = null; }
}

// ── Warmup → results transition ────────────────────────────────────────────

/**
 * Transitions from the warmup overlay to the results panel.
 * Completes the loading bar to 100%, fades out the warmup overlay,
 * and shows the main results container after a 420ms CSS transition.
 */
function hideWarmup() {
  stopTicker();
  stopBar();
  wuFill.style.width = "100%";

  warmupEl.style.opacity = "0";
  warmupEl.style.pointerEvents = "none";

  mainEl.classList.remove("hidden");
  setTimeout(() => { warmupEl.style.display = "none"; }, 420);
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Removes the "hidden" class from an element, making it visible. */
function show(el)  { el.classList.remove("hidden"); }

/** Adds the "hidden" class to an element, hiding it via `display: none`. */
function hide(el)  { el.classList.add("hidden"); }

/**
 * Updates the loading stage label in both the warmup overlay and the inline status.
 *
 * @param {string} msg - The stage label to display (e.g. "Fetching page…").
 */
function setStage(msg) {
  wuStatus.textContent = msg;
  statusInline.textContent = msg;
  show(statusInline);
}

/**
 * Displays a user-facing error message in the popup.
 * Hides the warmup overlay and shows the error element.
 *
 * @param {string} msg - The error message to display.
 */
function showError(msg) {
  hideWarmup();
  errorEl.textContent = msg;
  show(errorEl);
}

/**
 * Escapes a string for safe insertion as HTML text content.
 * Prevents XSS when setting innerHTML with article-derived text.
 *
 * @param {string} str - Raw string to escape.
 * @returns {string} HTML-safe string with &, <, >, and " escaped.
 */
function escHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Renders an array of analysis items into the popup items list.
 *
 * Clears the list before rendering. Each item gets a label badge, question/cue
 * text, and a "why" explanation. All article-derived text is HTML-escaped.
 *
 * @param {Array<{label: string, text: string, why: string}>} items - Items to render.
 */
function renderItems(items) {
  itemsEl.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="item-label label-${item.label}">${item.label}</span>
      <p class="item-text">${escHtml(item.text)}</p>
      <p class="item-why">${escHtml(item.why)}</p>
    `;
    itemsEl.appendChild(li);
  }
}

/**
 * Handles a successful analysis result from the API stream.
 *
 * Stores the result in `bundle` state (normalising single-mode responses to the
 * same shape), renders the active tab's items, and transitions from the warmup
 * overlay to the results panel.
 *
 * @param {{ mode: string, bundle?: object, items?: Array }} data
 *   The result payload from the stream's "result" event.
 */
function showResults(data) {
  if (data.mode === "bundle") {
    bundle = data.bundle;
  } else {
    bundle = { [data.mode]: data.items };
    currentTab = data.mode;
  }

  renderItems(bundle[currentTab] ?? bundle[Object.keys(bundle)[0]]);

  hideWarmup();
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
  });
});

// ── NDJSON stream consumer ─────────────────────────────────────────────────

/**
 * Fetches the analysis for the given URL from the API and processes the NDJSON stream.
 *
 * Dispatches four event types:
 *   - `progress` — updates the stage label via `setStage`.
 *   - `result`   — passes data to `showResults` and ends the loop.
 *   - `choice`   — shows the multi-article candidate picker; each candidate button
 *                  re-invokes `runAnalysis` with the chosen URL.
 *   - `error`    — passes message to `showError` and ends the loop.
 *
 * Uses a ReadableStream reader for progressive rendering. Falls back to an error
 * message if the API is unreachable or returns a non-OK status.
 *
 * @param {string} url - The source page URL (used as the hub URL for candidate re-fetch).
 * @param {string|null} chosenUrl - A pre-selected article URL from the candidate picker, or null.
 */
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
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    showError("Could not reach the API. Is the app running?");
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
        setStage(event.stage);

      } else if (event.type === "result") {
        showResults(event.data);
        break outer;

      } else if (event.type === "choice") {
        // Hub page — show candidate articles
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
            startTicker();
            startBar();
            hide(mainEl);
            show(warmupEl);
            warmupEl.style.opacity = "1";
            warmupEl.style.pointerEvents = "";
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

// ── Entry point ────────────────────────────────────────────────────────────

/**
 * Popup entry point. Reads the `url` and `error` query parameters injected by
 * the background service worker, starts the warmup visuals, and kicks off analysis.
 *
 * Shows a user-facing error if no URL was passed (e.g. the user clicked the extension
 * on a new tab or browser UI page rather than a web article).
 */
(async () => {
  const params = new URLSearchParams(window.location.search);
  const error  = params.get("error");
  const tabUrl = params.get("url");

  // Start warmup visuals immediately
  startTicker();
  startBar();

  if (error === "nourl" || !tabUrl) {
    showError("Open a web article first, then click the extension.");
    return;
  }

  await runAnalysis(tabUrl, null);
})();
