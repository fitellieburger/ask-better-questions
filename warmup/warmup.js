const cfg = window.WARMUP_CONFIG || {};
const APP_BASE = (cfg.APP_BASE || "https://ask-better-questions.onrender.com/").replace(/\/$/, "");
const EXTRACTOR_BASE = (cfg.EXTRACTOR_BASE || "https://ask-better-questions-vrjh.onrender.com").replace(/\/$/, "");

const APP_HEALTH = `${APP_BASE}/api/health`;
const EXTRACTOR_HEALTH = `${EXTRACTOR_BASE}/health`;
const REDIRECT_TO = `${APP_BASE}/`;  // force a real navigation

let ready = false;
let redirected = false;

// ---- DOM ----
const dotApp = document.getElementById("dotApp");
const dotExt = document.getElementById("dotExt");

const track = document.getElementById("tickerTrack");
const panelA = document.getElementById("panelA");
const panelB = document.getElementById("panelB");

const loadingFill = document.getElementById("loadingFill");

let warmupTicks = 0;
const WARMUP_STEP = 5;
const WARMUP_CAP = 95;
const WARMUP_MAX_TICKS = 19;

function setLoading(pct) {
  if (!loadingFill) return;
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  loadingFill.style.width = `${v}%`;
}

function setDot(el, ok) {
  el.classList.toggle("ok", !!ok);
}

async function ping(url, timeoutMs = 4500) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    await fetch(url, { method: "GET", mode: "no-cors", cache: "no-store", signal: ac.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(to);
  }
}

// ---- Slide rendering ----
/**
 * Slides are HTML strings. Keep them short: 2–3 lines.
 * Use <em> for Playfair emphasis where useful.
 */
const brandSlide = `
  <h1 class="brand-headline">
    <span class="brand-ask">Ask</span>
    <span class="brand-rest">Better Questions</span>
  </h1>
`;

const purposeSlide1 = `
  <h1 class="brand-headline">
    <span class="brand-rest">Read with </span>
    <span class="brand-ask">Intent</span>
  </h1>
`;

const purposeSlide2 = `
  <h1 class="brand-headline">
        <span class="brand-rest">What do you </span>
        <span class="brand-ask">hope to see? </span>
        
    </h1>
`;

const tips = [
  {
    html: `
      <h1 class="brand-headline">
    <span class="brand-ask">Question </span>
    <span class="brand-rest">the author</span>
  </h1>
    `
  },
  {
    html: `
      <h1 class="brand-headline">
        <span class="brand-rest">Is it </span>
        <span class="brand-ask">heat,</span>
        <span class="brand-rest"> or just </span>
        <span class="brand-ask">hot air?</span>
    </h1>
    `
  },
  {
    html: `
      <h1 class="brand-headline">
        <span class="brand-rest">Don't get </span>
        <span class="brand-ask">caught</span>
        <span class="brand-rest"> in someone else's </span>
        <span class="brand-ask">emotion.</span>
        </h1>
     
    `
  },
  {
    html: `
      <h1 class="brand-headline">
        <span class="brand-rest">Look for </span>
        <span class="brand-ask">signals</span>
        <span class="brand-rest"> in the text. </span>
        </h1>
    `
  },
  {
    html: `
    <h1 class="brand-headline">
        <span class="brand-ask">Notice</span>
        <span class="brand-rest"> what's missing. </span>
        </h1>
    `
  },
  {
    html: `
    <h1 class="brand-headline">
        <span class="brand-rest">Spot the </span>
        <span class="brand-ask">shift </span>
        <span class="brand-rest">find your </span>
        <span class="brand-ask">focus </span>
        </h1>
    `
  },
    {
    html: `
    <h1 class="brand-headline">
        <span class="brand-rest">Take a deep </span>
        <span class="brand-ask">breath</span>
        
        <span class="brand-rest">...how do you feel?</span>
        
        </h1>
    `
  },
  {
  html: `
    <h1 class="brand-headline">
      <span class="brand-ask">Pause</span>
      <span class="brand-rest"> before you react.</span>
    </h1>
  `
},
{
  html: `
    <h1 class="brand-headline">
      <span class="brand-rest">Ask what’s being </span>
      <span class="brand-ask">asked of you.</span>
    </h1>
  `
},
{
  html: `
    <h1 class="brand-headline">
      <span class="brand-rest">Who benefits from </span>
      <span class="brand-ask">believing</span>
      <span class="brand-rest"> this?</span>
    </h1>
  `
},
{
  html: `
    <h1 class="brand-headline">
      <span class="brand-rest">What’s the </span>
      <span class="brand-ask">claim?</span>
      <span class="brand-rest"> What’s the proof?</span>
    </h1>
  `
},
{
  html: `
    <h1 class="brand-headline">
      <span class="brand-rest">Strong feeling?</span>
      <span class="brand-ask"> Slow down.</span>
    </h1>
  `
},
{
  html: `
    <h1 class="brand-headline">
      <span class="brand-rest">Notice the </span>
      <span class="brand-ask">emotion</span>
      <span class="brand-rest">—then read.</span>
    </h1>
  `
},
{
  html: `
    <h1 class="brand-headline">
      <span class="brand-rest">Urgency is a </span>
      <span class="brand-ask">signal.</span>
      <span class="brand-rest">not a command.</span>
    </h1>
  `
},
{
  html: `
    <h1 class="brand-headline">
      <span class="brand-rest">If it wants you angry,</span>
      <span class="brand-ask">ask why.</span>
    </h1>
  `
},
{
  html: `
    <h1 class="brand-headline">
      <span class="brand-rest">Being confident </span>
      <span class="brand-ask">confident</span>
      <span class="brand-rest">isn't being </span>
      <span class="brand-ask">right.</span>
    </h1>
  `
},
{
  html: `
    <h1 class="brand-headline">
    <span class="brand-ask">Loud</span>
      <span class="brand-rest"> doesn’t mean true.</span>
    </h1>
  `
},
{
  html: `
    <h1 class="brand-headline">
      <span class="brand-rest">Coincidence isn’t </span>
      <span class="brand-ask">evidence.</span>
    </h1>
  `
},
{
  html: `
    <h1 class="brand-headline">
      <span class="brand-rest">Are you learning—</span>
      <span class="brand-ask">or just nodding?</span>
    </h1>
  `
},
{
  html: `
    <h1 class="brand-headline">
      <span class="brand-rest">Does this make sense—</span>
      <span class="brand-ask">or just feel good?</span>
    </h1>
  `
}
];

// ---- Sequence control ----
// First two are fixed, then random tips forever.
let stage = 1; // 0=brand, 1=purpose, 2+=tips
let lastTipIndex = -1;

// We animate by sliding the whole panel height (100% viewport).
let showingA = true;

function setPanelHTML(panelEl, html) {
  panelEl.innerHTML = html;
}

function pickRandomTipIndex() {
  if (tips.length <= 1) return 0;
  let idx = Math.floor(Math.random() * tips.length);
  // avoid immediate repeat
  if (idx === lastTipIndex) idx = (idx + 1) % tips.length;
  lastTipIndex = idx;
  return idx;
}

function nextSlideHTML() {
  if (stage === 0) { stage++; return brandSlide; }
  if (stage === 1) { stage++; return purposeSlide1; }
  if (stage === 2) { stage++; return purposeSlide2; }
  // random tips
  const idx = pickRandomTipIndex();
  stage++;
  return tips[idx].html;
}

function settle(el){
  if (!el) return;

  // If GSAP isn't loaded for any reason, fall back silently.
  if (typeof gsap === "undefined") return;

  gsap.killTweensOf(el);
  gsap.fromTo(
    el,
    { y: 10, opacity: 0, filter: "blur(6px)" },
    { y: 0, opacity: 1, filter: "blur(0px)", duration: 0.7, ease: "power3.out" }
  );
}


function advanceTicker() {
    if (typeof gsap === "undefined") {
    panelA.innerHTML = nextSlideHTML();
    return;
  }

  gsap.to(panelA, {
    opacity: 0,
    filter: "blur(4px)",
    duration: 0.18,
    ease: "power1.out",
    onComplete: () => {
      panelA.innerHTML = nextSlideHTML();
      settle(panelA);
    }
  });

}



// Init: top panel is brand, next will be purpose.
setPanelHTML(panelA, brandSlide);
settle(panelA);
panelB.innerHTML = "";


// Start advancing: purpose after a beat, then random tips
setTimeout(advanceTicker, 2600);
setInterval(advanceTicker, 5200);

async function warmupLoop() {

    // progress: 5% per iteration, cap at 95% (19 ticks)
  warmupTicks = Math.min(WARMUP_MAX_TICKS, warmupTicks + 1);
  setLoading(Math.min(WARMUP_CAP, warmupTicks * WARMUP_STEP));

    
  const [appOk, extOk] = await Promise.all([
    ping(APP_HEALTH),
    ping(EXTRACTOR_HEALTH),
  ]);

  //appOk = false; // DEV: force extractor failure to test loading state
  
if (appOk && extOk && !ready) {
  ready = true;

  // Set loading to 100% before redirecting, so it doesn't feel like a stall.
    setLoading(100);

  // Stop polling (by preventing new scheduling)
  redirected = true;

  // Navigate in a way that can't be "back button trapped"
  setTimeout(() => {
    console.log("Redirecting to:", REDIRECT_TO);
    window.location.replace(REDIRECT_TO);
  }, 150); // keep short; no need to wait 450ms
  return;
}

if (!redirected) setTimeout(warmupLoop, 700);


}

warmupLoop();
