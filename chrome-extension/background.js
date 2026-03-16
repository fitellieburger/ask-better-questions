// background.js — Ask Better Questions Chrome Extension

// Main Next.js app — must include the /api/questions path:
const API_URL = "https://ask-better-questions.onrender.com/api/questions";

// Health endpoints — pinged in parallel so both Render services wake up early:
const APP_HEALTH_URL       = "https://ask-better-questions.onrender.com/api/health";
const EXTRACTOR_HEALTH_URL = "https://ask-better-questions-vrjh.onrender.com/health";

// ── Side Panel: open when toolbar button is clicked ───────────────────────
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ── Message relay between side panel and content scripts ──────────────────

/**
 * Handles messages from side_panel.js:
 *
 *  get-tab-url      → query the active tab and return { url, tabId }
 *  apply-highlights → inject content.js into the tab, then send excerpts
 *  clear-highlights → tell content.js to remove all highlights
 *  pulse-highlight  → tell content.js to pulse a specific excerpt
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  if (msg.type === "get-tab-url") {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      sendResponse({ url: tab?.url ?? null, tabId: tab?.id ?? null });
    });
    return true; // keep message channel open for async sendResponse
  }

  if (msg.type === "apply-highlights") {
    chrome.scripting.executeScript({
      target: { tabId: msg.tabId },
      files: ["content.js"],
    }).then(() => {
      chrome.tabs.sendMessage(msg.tabId, {
        type: "abq-apply-highlights",
        excerpts: msg.excerpts,
      }).catch(() => {});
    }).catch(() => {});
  }

  if (msg.type === "clear-highlights") {
    chrome.tabs.sendMessage(msg.tabId, { type: "abq-clear-highlights" }).catch(() => {});
  }

  if (msg.type === "pulse-highlight") {
    chrome.tabs.sendMessage(msg.tabId, {
      type: "abq-pulse",
      index: msg.index,
    }).catch(() => {});
  }
});

// ── Tab change notifications → side panel ─────────────────────────────────

/**
 * Notifies the side panel when the user switches active tab.
 * The side panel uses this to show a "Page changed — click ↻" nudge.
 */
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.runtime.sendMessage({ type: "tab-changed", tabId }).catch(() => {});
});

/**
 * Notifies the side panel when the active tab fully loads a new page.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    chrome.runtime.sendMessage({ type: "tab-changed", tabId }).catch(() => {});
  }
});
