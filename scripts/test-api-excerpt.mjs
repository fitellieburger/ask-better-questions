#!/usr/bin/env node
// Usage: node scripts/test-api-excerpt.mjs <article-url>
// Tests that the API returns excerpt fields on every item.

const API_URL =
  process.env.API_URL ?? "https://ask-better-questions.onrender.com/api/questions";

const articleUrl = process.argv[2];
if (!articleUrl) {
  console.error("Usage: node scripts/test-api-excerpt.mjs <article-url>");
  process.exit(1);
}

console.log(`POST ${API_URL}`);
console.log(`URL: ${articleUrl}\n`);

const resp = await fetch(API_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ inputMode: "url", url: articleUrl, mode: "bundle" }),
  signal: AbortSignal.timeout(180_000),
});

if (!resp.ok) {
  console.error(`HTTP ${resp.status}`);
  process.exit(1);
}

const text = await resp.text();
let missing = 0;

for (const line of text.split("\n")) {
  if (!line.trim()) continue;
  let event;
  try { event = JSON.parse(line); } catch { continue; }

  if (event.type === "progress") {
    console.log(`[progress] ${event.stage}`);
  } else if (event.type === "error") {
    console.error(`[error] ${event.error} ${event.detail ?? ""}`);
    process.exit(1);
  } else if (event.type === "result") {
    const { bundle } = event.data;
    for (const [set, items] of Object.entries(bundle)) {
      console.log(`\n=== ${set} ===`);
      for (const item of items) {
        const ok = typeof item.excerpt === "string" && item.excerpt.length > 0;
        if (!ok) missing++;
        console.log(`  [${item.label}] ${ok ? "✓" : "✗ MISSING"} excerpt: ${JSON.stringify(item.excerpt)}`);
      }
    }
    console.log(missing === 0 ? "\n✓ All excerpts present." : `\n✗ ${missing} excerpt(s) missing.`);
  }
}
