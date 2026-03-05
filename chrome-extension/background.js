// background.js — Ask Better Questions Chrome Extension

// Main Next.js app — must include the /api/questions path:
const API_URL = "https://ask-better-questions.onrender.com/api/questions";

// Health endpoints — pinged in parallel so both Render services wake up early:
const APP_HEALTH_URL       = "https://ask-better-questions.onrender.com/api/health";
const EXTRACTOR_HEALTH_URL = "https://ask-better-questions-vrjh.onrender.com/health";

// ── Auto-start: inject content.js after user navigates from a choice pick ──

const autoStartTabs = new Set();

/**
 * Records a tab ID for auto-injection when the user clicks a candidate article link.
 * Content script sends "abq-auto-start" before navigating to the chosen article URL,
 * so the panel relaunches automatically once the new page loads.
 */
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "abq-auto-start" && sender.tab?.id) {
    autoStartTabs.add(sender.tab.id);
  }
});

/**
 * After a tab fully loads, checks if it was flagged for auto-start.
 * If so, injects content.js to launch the analysis panel automatically.
 * Silently ignores injection failures (e.g. restricted pages).
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  if (!autoStartTabs.has(tabId)) return;
  autoStartTabs.delete(tabId);
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch {}
});

// ── Panel toggle ──────────────────────────────────────────────────────────

/**
 * Toggles the Ask Better Questions panel on the active tab when the extension
 * toolbar button is clicked.
 *
 * If the panel is already present (`#abq-host` exists), removes it and restores
 * the page's original body padding. Otherwise, injects content.js to create it.
 * Returns early if the tab is a restricted page where scripting is not permitted.
 */
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
    const [{ result: exists }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => !!document.getElementById("abq-host"),
    });

    if (exists) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const host = document.getElementById("abq-host");
          if (host) {
            document.body.style.paddingTop = host.dataset.savedPaddingTop ?? "";
            host.remove();
          }
        },
      });
      return;
    }
  } catch {
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"],
  });
});

// ── Streaming proxy via long-lived port ───────────────────────────────────
// Content scripts can't fetch HTTP from HTTPS pages (mixed content).
// The background service worker has no such restriction.

/**
 * Handles long-lived port connections from content.js for streaming analysis.
 *
 * Only responds to ports named "abq-analyze". On receiving the initial URL message:
 *
 * 1. Pings both health endpoints in parallel. If both respond within 3 seconds,
 *    sends `{ type: "progress", stage: "__alive__" }` to skip the warmup message.
 *    Otherwise, sends `{ type: "progress", stage: "Waking up server…" }` after 5s.
 *
 * 2. POSTs to the API with a 3-minute timeout (accounts for cold starts on Render).
 *
 * 3. Reads the full NDJSON response as text (more reliable in MV3 service workers
 *    than ReadableStream, which can silently fail on slow/chunked responses).
 *
 * 4. Forwards each parsed JSON line back to the content script via the port.
 *
 * Keepalive "ping" messages from the content script are silently ignored.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "abq-analyze") return;

  port.onMessage.addListener(async (msg) => {
    if (msg.type === "ping") return; // keepalive ping from content script — ignore
    const { url, chosenUrl } = msg;
    // If both services respond within 3s they're already awake — skip the warmup.
    // Otherwise, fall through to the "Waking up server…" message after 5s.
    const wakeTimer = setTimeout(() => {
      try { port.postMessage({ type: "progress", stage: "Waking up server…" }); } catch {}
    }, 5_000);

    Promise.all([
      fetch(APP_HEALTH_URL,       { signal: AbortSignal.timeout(3_000) }).then(r => r.ok).catch(() => false),
      fetch(EXTRACTOR_HEALTH_URL, { signal: AbortSignal.timeout(3_000) }).then(r => r.ok).catch(() => false),
    ]).then(([appOk, extOk]) => {
      if (appOk && extOk) {
        clearTimeout(wakeTimer); // already up — no need for the "waking up" message
        try { port.postMessage({ type: "progress", stage: "__alive__" }); } catch {}
      }
    });

    const body = {
      inputMode: "url",
      url,
      mode: "bundle",
      ...(chosenUrl ? { chosenUrl } : {}),
    };

    let resp;
    try {
      resp = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000), // 3 min: app cold start + extractor cold start + OpenAI
      });
    } catch (err) {
      clearTimeout(wakeTimer);
      port.postMessage({ type: "error", error: "Could not reach the API. Is the app running?" });
      return;
    }
    clearTimeout(wakeTimer);

    if (!resp.ok) {
      port.postMessage({ type: "error", error: `API error ${resp.status}.` });
      return;
    }

    // Read the full NDJSON response as text — more reliable in MV3 service workers
    // than ReadableStream, which can silently fail on slow/chunked Render responses.
    let text;
    try {
      text = await resp.text();
    } catch {
      port.postMessage({ type: "error", error: "Failed to read response." });
      return;
    }

    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try { port.postMessage(JSON.parse(line)); } catch { /* skip malformed */ }
    }
  });
});
