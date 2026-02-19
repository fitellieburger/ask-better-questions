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
const meterEl       = document.getElementById("meter");
const meterBar      = document.getElementById("meter-bar");
const meterLabel    = document.getElementById("meter-label");
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

function showSlide(html) {
  tickerPanel.classList.remove("settle-in");
  // Trigger reflow to restart animation
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

let barPct         = 0;
let barInterval    = null;
const BAR_STEP     = 5;
const BAR_CAP      = 90;
const BAR_TICK_MS  = 700;

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

// ── Helpers ───────────────────────────────────────────────────────────────

function show(el)  { el.classList.remove("hidden"); }
function hide(el)  { el.classList.add("hidden"); }

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

function renderMeter(meter) {
  if (!meter) { hide(meterEl); return; }
  meterBar.style.width = meter.value + "%";
  meterLabel.textContent = meter.label;
  show(meterEl);
}

function showResults(data) {
  if (data.mode === "bundle") {
    bundle = data.bundle;
  } else {
    bundle = { [data.mode]: data.items };
    currentTab = data.mode;
  }

  renderItems(bundle[currentTab] ?? bundle[Object.keys(bundle)[0]]);
  renderMeter(data.meter);

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
