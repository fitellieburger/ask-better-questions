"use client";

import { useMemo, useState } from "react";
import { HelpTip } from "@/app/components/HelpTip";
import type { CSSProperties } from "react";

type CSSVars = CSSProperties & {
  [key: `--${string}`]: string | number;
};

type Label = "Words" | "Proof" | "Missing";

type Item = {
  label: Label;
  text: string;
  why: string;
};

type Meta = {
  neutrality: number;
  heat: number;
  support: number; // raw model score 0–100
};

type Meter = {
  value: number; // 0–100 (support-only, curved on server)
  label: "Supported" | "Mixed support" | "Unsupported";
  glow?: number; // 0–100 (heat-derived decoration)
  wave?: boolean; // true when heat is very high (>80)
};

type ExtractCandidate = {
  title: string;
  url: string;
  score: number;
  snippet: string;
};

type NeedsChoice = {
  mode: "fast" | "deeper" | "cliff";
  needsChoice: true;
  sourceUrl: string;
  candidates: ExtractCandidate[];
};

type ApiSuccess = {
  mode: "fast" | "deeper" | "cliff";
  items: Item[];
  meta?: Meta;
  meter?: Meter;
};

type ApiError = {
  error: string;
  detail?: string;
};

type ApiResponse = ApiSuccess | ApiError | NeedsChoice;

function isApiError(x: ApiResponse): x is ApiError {
  return "error" in x;
}

// Heat “menu” labels
function heatLabel(heat: number | null): string {
  if (heat === null) return "—";
  if (heat >= 85) return "Committed";
  if (heat >= 70) return "Spicy";
  if (heat >= 50) return "Warm";
  return "Mild";
}

type HeatVars = {
  vars: CSSVars;
  band: "mild" | "warm" | "spicy" | "committed";
};

/**
 * Map raw heat (0–100) to CSS variables for the glow.
 * Visual intent:
 * - Mild / Warm / Spicy / Committed are clearly distinct
 * - Nuance preserved within each band
 * - Heat NEVER affects support fill
 */
function heatToCSSVars(
  heatRaw: number | null,
  enabled: boolean
): HeatVars {
  if (!enabled || heatRaw === null) {
    return {
      band: "mild",
      vars: {
        "--heatOpacity": 0,
        "--heatBlur": "0px",
        "--heatSpread": "0px"
      }
    };
  }

  const h = Math.max(0, Math.min(100, Math.round(heatRaw)));

  // --- Band selection ---
  const band =
    h >= 85 ? "committed" :
    h >= 70 ? "spicy" :
    h >= 50 ? "warm" :
    "mild";

  // --- Base look per band (intentionally far apart) ---
  const base = {
    mild:      { opacity: 0.10, blur: 6,  spread: 1 },
    warm:      { opacity: 0.26, blur: 14, spread: 3 },
    spicy:     { opacity: 0.48, blur: 22, spread: 6 },
    committed: { opacity: 0.72, blur: 30, spread: 9 }
  }[band];

  // --- Progress within band (0..1) ---
  const progress =
    band === "mild"      ? h / 50 :
    band === "warm"      ? (h - 50) / 20 :
    band === "spicy"     ? (h - 70) / 15 :
                            (h - 85) / 15;

  const t = Math.max(0, Math.min(1, progress));
  const eased = Math.pow(t, 0.6);

  return {
    band,
    vars: {
      "--heatOpacity": Math.min(0.9, base.opacity + eased * 0.08),
      "--heatBlur": `${Math.round(base.blur + eased * 6)}px`,
      "--heatSpread": `${Math.round(base.spread + eased * 3)}px`
    }
  };
}


export default function Page() {
  // --- User input ---
  const [inputMode, setInputMode] = useState<"paste" | "url">("paste");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");

  // Output mode
  const [mode, setMode] = useState<"fast" | "deeper" | "cliff">("fast");

  // --- Results ---
  const [items, setItems] = useState<Item[] | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [meter, setMeter] = useState<Meter | null>(null);

  // --- Multi-story chooser (hub pages) ---
  const [candidates, setCandidates] = useState<ExtractCandidate[] | null>(null);
  const [chosenUrl, setChosenUrl] = useState<string>("");

  // --- UX state ---
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const openUrl = chosenUrl || (inputMode === "url" ? url.trim() : "");

  // UI-ready meter values from API
  const meterUI = useMemo(() => {
    if (!meter) return null;

    const fill = Math.max(0, Math.min(100, Math.round(meter.value)));
    const glow =
      typeof meter.glow === "number"
        ? Math.max(0, Math.min(100, Math.round(meter.glow)))
        : 0;

    return {
      fill,
      label: meter.label,
      glow,
      wave: !!meter.wave
    };
  }, [meter]);

  // Heat label (menu-style) from raw meta.heat (not the glow)
  const heatUI = useMemo(() => {
    const h = typeof meta?.heat === "number" ? Math.max(0, Math.min(100, Math.round(meta.heat))) : null;
    return { value: h, label: heatLabel(h) };
  }, [meta]);

  function clearCandidatesUI() {
    setCandidates(null);
    setChosenUrl("");
  }

  const canSubmit =
    !loading &&
    (inputMode === "paste" ? text.trim().length >= 80 : url.trim().length >= 8);

  async function onGenerate(opts?: { chosenUrlOverride?: string; urlOverride?: string }) {
    setLoading(true);
    setStage(inputMode === "url" ? "Fetching page…" : "Reading text…");
    setError(null);
    setItems(null);
    setMeta(null);
    setMeter(null);


    setShowInfo(false); // ✅ auto-hide when a query is run

    const chosenFromClick = opts?.chosenUrlOverride?.trim() ?? "";
    if (!chosenFromClick) {
      clearCandidatesUI();
    } else {
      setCandidates(null);
    }

    try {
      const urlToUse = (opts?.urlOverride ?? url).trim();
      const chosenToUse = chosenFromClick || chosenUrl.trim();

      const payload =
        inputMode === "paste"
          ? { inputMode, text, mode }
          : { inputMode, url: urlToUse, mode, chosenUrl: chosenToUse || undefined };

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 25_000);

      setStage(inputMode === "url" ? "Extracting article text…" : "Analyzing…");

      const res = await fetch("/api/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(t);

      setStage("Writing output…");

      const data: ApiResponse = await res.json();

      if (!res.ok) {
        if (isApiError(data)) throw new Error(data.detail ?? data.error);
        throw new Error("Request failed");
      }

      if ("needsChoice" in data && data.needsChoice) {
        setCandidates(data.candidates ?? []);
        setStage(null);
        return;
      }

      if (!("items" in data)) {
        throw new Error("Malformed response");
      }

      setMeta(data.meta ?? null);
      setMeter(data.meter ?? null);
      setItems(data.items);
      setStage(null);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("That link is taking too long. Try again, or pick a specific story link.");
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("An unknown error occurred.");
      }
      setStage(null);
    } finally {
      setLoading(false);
    }
  }

  const meterFill = meterUI ? meterUI.fill : 0;

  const heatVarsResult = useMemo(() => {
  const heat =
    typeof meta?.heat === "number"
      ? meta.heat
      : null;

  return heatToCSSVars(heat, !!meterUI);
}, [meta?.heat, meterUI]);



  return (
    <main className="page">
      {/* Page header */}
      <header className="top">
  <div className="topRow">
    <div className="topLeft">
      <h1 className="brand-headline">
        <span className="brand-ask">Ask</span>{" "}
        <span className="brand-rest">Better Questions</span>
      </h1>

      <p className="sub">
        Paste an article. Stay above it with{" "}
        {mode === "cliff" ? "3 quick cues" : "3 easy questions"}.
      </p>
    </div>

    <button
      type="button"
      className="infoBtn"
      aria-label={showInfo ? "Hide info" : "Show info"}
      aria-expanded={showInfo}
      onClick={() => setShowInfo((v) => !v)}
      title="What is this?"
    >
      i
    </button>
  </div>
</header>

{/* Info box */}
      {showInfo &&  (
  <details className="vox-card infoCard" open>
    <summary className="summary infoSummary">
      <strong>A tool to stay above the text and think.</strong> 
    </summary>

    <div className="summary">
      <p className="infoP" style={{ marginTop: 0 }}>
        Ask Better Questions asks how a piece of writing works — not whether it is right or wrong.
        It points to wording, support, and missing standards so you can keep your footing.
      </p>
      <p>This is an early public release, and we hope you will keep asking better questions.</p>

      <ul className="infoList">
        <li><strong>Words</strong> — how labels and phrasing shape interpretation</li>
        <li><strong>Proof</strong> — what the text shows, checks, or asks you to accept</li>
        <li><strong>Missing</strong> — what standards, limits, or context are left unstated</li>
      </ul>

      <hr className="infoRule" />

      <p className="infoP">
        <strong>The Meter</strong> is a quick sense of how much the text shows vs. tells, and how intense the language feels. It’s not a scorecard or a verdict — it’s a glimpse of the text’s signals and vibes, warts and all.
        
      </p>

      <p className="infoP" style={{ marginBottom: 0 }}>
        <strong>Use:</strong> Read the questions or cues, then go back to the article.
        Now, you have signposts to find key moments that shape the piece’s meaning and impact. </p>
      <p>  You can also use the cues as a lens for future reading, or to compare how different pieces handle the same topic.
      </p>

      <hr className="infoRule" />

      <p className="infoP">
        <strong></strong> Ask Better Questions works best with news stories, essays, or analysis that make claims about the world. It is not designed for fiction, poetry, or casual writing.
        <strong> One piece of a series may also struggle here, as we look specifically at the text provided.</strong>
      </p>

      <p className="infoP" style={{ marginBottom: 0 }}>
        <strong>Get Better Answers</strong> is a peek under the hood, showing you what we are picking up on. It’s not a scorecard or a verdict — it’s a glimpse of the text’s signals and vibes, warts and all.
      </p>
    </div>
  </details>
)}

      {/* Input card */}
      <div className="input-card">
        {/* Input mode tabs (Paste / Link) */}
        <div className="input-tabs" role="tablist" aria-label="Input mode">
          <button
            type="button"
            role="tab"
            aria-selected={inputMode === "paste"}
            className={`input-tab ${inputMode === "paste" ? "active" : ""}`}
            onClick={() => {
              setInputMode("paste");
              clearCandidatesUI();
              setError(null);
            }}
          >
            Paste
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={inputMode === "url"}
            className={`input-tab ${inputMode === "url" ? "active" : ""}`}
            onClick={() => {
              setInputMode("url");
              clearCandidatesUI();
              setError(null);
            }}
          >
            Link
          </button>
        </div>

        <div className="input-body">
          {/* Paste vs URL input */}
          {inputMode === "paste" ? (
            <textarea
              className="article-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder="Paste article text here…"
            />
          ) : (
            <input
              className="url-input"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                clearCandidatesUI();
              }}
              placeholder="Paste a URL…"
            />
          )}

          {/* Action row */}
          <div className="action-row">
            <button className="primary-button" onClick={() => void onGenerate()} disabled={!canSubmit}>
              {loading ? "Generating…" : "Generate"}
            </button>

            <div className="status-slot" aria-live="polite">
              {loading ? (
                <div className="thinking">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                  <span className="thinkingText">{stage ?? "Let's Have a Think..."}</span>
                </div>
              ) : (
                <span className="status-text">
                  {inputMode === "paste"
                    ? text.trim().length < 80
                      ? "Paste a bit more text (≥ ~80 chars)."
                      : "Ready when you are."
                    : url.trim().length < 8
                    ? "Paste a link."
                    : "Ready when you are."}
                </span>
              )}
            </div>

            {/* Meter */}
            <div className="meterWrap" aria-label="Grounding meter">
              <div className="meterTop">
                <HelpTip text="Grounding: how consistently the text shows what it claims.">
                  <span className="meterLabel">Grounding</span>
                </HelpTip>

                <HelpTip text="Heat: how intense or charged the language feels (not whether it’s right).">
                  <span className="meterValue">{` ${heatUI.label}`}</span>
                </HelpTip>
              </div>

              <div
  className={["meterShell", meterUI?.wave ? "heatWave" : ""].join(" ")}
  style={heatVarsResult.vars}
>
  <div className="meterBar" role="img" aria-label="Grounding bar">
    <div className="meterFill" style={{ width: `${meterFill}%` }} />
  </div>

  <div className="meterGlow" aria-hidden="true" />
</div>

              {/* Labels beneath the bar: Unsupported -> Supported */}
              <div className="meterHint">
                <span>Unsupported</span>
                <span>Supported</span>
              </div>
            </div>
          </div>

          {error && <div className="error-box">{error}</div>}
        </div>
      </div>



      {/* Candidate selection list */}
      {candidates && candidates.length > 0 && (
        <section className="vox-card" style={{ marginTop: 14 }}>
          <h2 style={{ margin: "0 0 8px 0", fontSize: "1rem" }}>
            This link has multiple stories. Pick one:
          </h2>

          <div style={{ display: "grid", gap: 10 }}>
            {candidates.map((c) => (
              <button
                key={c.url}
                type="button"
                className="tab"
                style={{
                  textAlign: "left",
                  borderRadius: 12,
                  padding: "12px 12px"
                }}
                onClick={() => {
                  setChosenUrl(c.url);
                  setUrl(c.url);

                  queueMicrotask(() => {
                    void onGenerate({ chosenUrlOverride: c.url, urlOverride: c.url });
                  });
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: 4 }}>{c.title}</div>
                <div style={{ opacity: 0.8, fontSize: 13 }}>{c.snippet}</div>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            <button type="button" className="tab" onClick={clearCandidatesUI}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* Output mode tabs */}
      <div className="mode-tabs" role="tablist" aria-label="Output mode">
        <HelpTip text="Quick questions to get above the text. Generate again after switching modes.">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "fast"}
            className={`tab ${mode === "fast" ? "active" : ""}`}
            onClick={() => {
              setMode("fast");
              clearCandidatesUI();
            }}
          >
            Ask Better Questions
          </button>
        </HelpTip>

        <HelpTip text="Deeper questions, deeper understanding. Generate again after switching modes.">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "deeper"}
            className={`tab ${mode === "deeper" ? "active" : ""}`}
            onClick={() => {
              setMode("deeper");
              clearCandidatesUI();
            }}
          >
            Be More Curious
          </button>
        </HelpTip>

        <HelpTip text="Here's what we're looking at. Generate again after switching modes.">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "cliff"}
            className={`tab ${mode === "cliff" ? "active" : ""}`}
            onClick={() => {
              setMode("cliff");
              clearCandidatesUI();
            }}
          >
            Get Better Answers
          </button>
        </HelpTip>

        {openUrl && openUrl.length >= 8 && (
          <a
            className="open-link"
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open the source article in a new tab"
          >
            Open link ↗
          </a>
        )}
      </div>

{/* Results */}
      {items && (
        <section className="results">
          {items.map((it, i) => (
            <details key={i} className="vox-card">
              <summary className="summary">
                <strong>{it.label}:</strong> {it.text}
              </summary>
              <div className="caption">
                <strong>Why this:</strong> {it.why}
              </div>
            </details>
          ))}
        </section>
      )}

      

      
    </main>
  );
}
