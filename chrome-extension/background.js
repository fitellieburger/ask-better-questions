// background.js — Ask Better Questions Chrome Extension

// Main Next.js app — must include the /api/questions path:
const API_URL = "https://ask-better-questions.onrender.com/api/questions";

// Health endpoints — pinged in parallel so both Render services wake up early:
const APP_HEALTH_URL       = "https://ask-better-questions.onrender.com/api/health";
const EXTRACTOR_HEALTH_URL = "https://ask-better-questions-vrjh.onrender.com/health";

// ── Panel toggle ──────────────────────────────────────────────────────────
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
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "abq-analyze") return;

  port.onMessage.addListener(async ({ url, chosenUrl }) => {
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
        signal: AbortSignal.timeout(120_000), // 2 min: app cold start + extractor + OpenAI
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
