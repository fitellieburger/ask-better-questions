// app/api/questions/route.ts
import OpenAI from "openai";
import { buildPrompt, type Mode } from "@/lib/prompt";

export const runtime = "nodejs";

// OpenAI client (server-side only)
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -----------------------------
// Types
// -----------------------------
type Label = "Words" | "Proof" | "Missing";
type Meta = { neutrality: number; heat: number; support: number };

type NormalizedItem = { label: Label; text: string; why: string };

/**
 * Meter is a UI-ready summary value.
 *
 * UPDATED:
 * - value: 0–100 fill derived from SUPPORT ONLY (curved for perception)
 * - label: friendly bucket based on value
 * - glow: 0–100 intensity derived from HEAT (UI decoration)
 * - wave: boolean for "wavy heat" effect at very high heat
 *
 * Backward compatible: existing UI can keep using value + label.
 */
type Meter = {
  value: number; // 0–100 fill (support-only, curved)
  label: "Supported" | "Mixed support" | "Unsupported";
  glow?: number; // 0–100 (heat-derived decoration)
  wave?: boolean; // true when heat is very high (e.g., > 80)
};

type NormalizedOutput = {
  mode: Mode;
  items: NormalizedItem[];
  meta?: Meta;
  meter?: Meter; // optional so existing UI doesn't break
};

type ExtractCandidate = {
  title: string;
  url: string;
  score: number;
  snippet: string;
};

type ExtractResponse = {
  url: string;
  chosen_url: string;
  title: string;
  text: string;
  is_multi: boolean;
  candidates: ExtractCandidate[];
};

type NeedsChoice = {
  mode: Mode;
  needsChoice: true;
  sourceUrl: string;
  candidates: ExtractCandidate[];
};

type ApiOut = NormalizedOutput | NeedsChoice;

type Body = {
  mode?: unknown;
  inputMode?: unknown;
  text?: unknown;
  url?: unknown;
  chosenUrl?: unknown;
};

// -----------------------------
// Small helpers
// -----------------------------

// Mode parsing with safe default
function parseMode(raw: unknown): Mode {
  return raw === "deeper" || raw === "fast" || raw === "cliff" ? raw : "fast";
}

// Label guard used by normalization
function isLabel(x: unknown): x is Label {
  return x === "Words" || x === "Proof" || x === "Missing";
}

// Meta guard used by normalization
function isMeta(value: unknown): value is Meta {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.neutrality === "number" &&
    typeof v.heat === "number" &&
    typeof v.support === "number"
  );
}

// Clamp meta values to 0..100 and round
function clamp0to100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

// JSON response helper
function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function badRequest(message: string): Response {
  return json(400, { error: message });
}

function unprocessable(message: string): Response {
  return json(422, { error: message });
}

// Needs-choice response for multi-story pages
function needsChoice(mode: Mode, extracted: ExtractResponse): Response {
  const out: NeedsChoice = {
    mode,
    needsChoice: true,
    sourceUrl: extracted.url,
    candidates: extracted.candidates ?? []
  };
  return json(200, out);
}

// Enforce minimum text length (paste + extracted)
function requireMinText(text: string, min = 80): string {
  const t = text.trim();
  if (t.length < min) throw new Error(`MIN_TEXT:${min}`);
  return t;
}

// -----------------------------
// Meter logic (UPDATED: Support fill + Heat glow)
// -----------------------------

/**
 * Clamp for display meter only.
 * Prevents "no fill at all" and avoids "always maxed out".
 */
function clampForMeter(n: number, lo = 10, hi = 95): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/**
 * Turn a meter value into a user-facing label.
 */
function meterLabel(v: number): Meter["label"] {
  if (v >= 80) return "Supported";
  if (v >= 55) return "Mixed support";
  return "Unsupported";
}

/**
 * Support -> fill curve (support-only)
 *
 * Design goals:
 * - Preserve intuitive mapping: 55 support should look ~55% (not 25%).
 * - Add *gentle* separation in the 60–85 range (where humans perceive nuance).
 * - Keep monotonic and bounded.
 *
 * Implementation:
 * - Work in [0,1]
 * - Apply a small anchored boost term: k*(s-anchor)*s*(1-s)
 *   This keeps s=anchor fixed (no change), boosts above anchor, slightly lowers below.
 */
function curveSupportToFill(support: number): number {
  const s = clamp0to100(support) / 100; // 0..1
  const anchor = 0.55;                 // keep 55% “honest”
  const k = 1.0;                       // gentle; tune 0.8..1.4

  const y = s + k * (s - anchor) * s * (1 - s);

  // Guard rails
  const yClamped = Math.max(0, Math.min(1, y));
  return yClamped * 100; // 0..100
}

/**
 * Compute UI meter:
 * - Fill is SUPPORT ONLY (curved + clamped)
 * - Glow is HEAT ONLY (export raw heat 0–100; UI decides rendering)
 * - Wave triggers for very high heat (>80)
 */
function computeMeter(meta: Meta): Meter {
  const support = clamp0to100(meta.support);
  const heat = clamp0to100(meta.heat);

  const curvedFill = curveSupportToFill(support);

  // Only clamp at the very end for the thermometer look
  const value = clampForMeter(curvedFill, 10, 95);

  return {
    value,
    label: meterLabel(value),
    glow: heat,       // 🔥 raw heat, do not curve server-side
    wave: heat > 80
  };
}


// -----------------------------
// URL extraction (calls your Python microservice)
// -----------------------------
async function extractFromUrl(url: string): Promise<ExtractResponse> {
  const extractorUrl =
    process.env.EXTRACTOR_URL ?? "https://ask-better-questions-vrjh.onrender.com/extract";

  const r = await fetch(extractorUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Shared secret: your extractor should verify this
      "x-extractor-key": process.env.EXTRACTOR_KEY ?? ""
    },
    body: JSON.stringify({ url, include_candidates: true })
  });

  if (!r.ok) {
    const msg = await r.text();
    throw new Error(`Extractor failed: ${msg}`);
  }

  return (await r.json()) as ExtractResponse;
}

// -----------------------------
// Model call (Responses API)
// -----------------------------
async function runModel(prompt: string): Promise<unknown> {
  const resp = await client.responses.create({
    model: "gpt-5.2",
    input: prompt,
    // Ask for strict JSON object output
    text: { format: { type: "json_object" } }
  });

  const output = resp.output?.[0];
  if (!output || output.type !== "message") {
    throw new Error("No message output from model.");
  }

  const content = output.content?.[0];
  if (!content || content.type !== "output_text") {
    throw new Error("Model did not return text output.");
  }

  return JSON.parse(content.text);
}

// -----------------------------
// Input resolution (paste vs url)
// -----------------------------
async function resolveInput(
  mode: Mode,
  body: Body
): Promise<
  | { kind: "text"; text: string }
  | { kind: "choice"; response: Response }
> {
  const inputMode = body.inputMode === "url" ? "url" : "paste";

  // Paste mode: use provided text
  if (inputMode === "paste") {
    const text = String(body.text ?? "");
    try {
      return { kind: "text", text: requireMinText(text, 80) };
    } catch {
      return {
        kind: "choice",
        response: badRequest(
          "Paste a bit more article text (at least ~80 characters)."
        )
      };
    }
  }

  // URL mode: extract from URL (or from chosen candidate URL)
  const url = String(body.url ?? "").trim();
  const chosenUrl = String(body.chosenUrl ?? "").trim();

  if (url.length < 8) {
    return { kind: "choice", response: badRequest("Paste a valid URL.") };
  }

  // Extract the chosen URL if present; otherwise extract the original URL
  const targetUrl = chosenUrl || url;
  const extracted = await extractFromUrl(targetUrl);

  // Only show candidates when the user has NOT picked yet
  if (!chosenUrl && extracted.is_multi) {
    return { kind: "choice", response: needsChoice(mode, extracted) };
  }

  // Otherwise proceed with extracted text
  const text = (extracted.text ?? "").trim();
  if (text.length < 80) {
    return {
      kind: "choice",
      response: unprocessable(
        "Could not extract enough article text from that URL."
      )
    };
  }

  return { kind: "text", text };
}

// -----------------------------
// Normalization
// -----------------------------
function normalizeModelOutput(parsed: unknown, mode: Mode): NormalizedOutput {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Model returned non-object JSON.");
  }

  const obj = parsed as Record<string, unknown>;

  // Accept either "items" or legacy "questions"
  const rawItems = (obj.items ?? obj.questions) as unknown;

  if (!Array.isArray(rawItems) || rawItems.length !== 3) {
    throw new Error("Model returned unexpected shape (need 3 items).");
  }

  const items: NormalizedItem[] = rawItems.map((raw) => {
    if (typeof raw !== "object" || raw === null) {
      throw new Error("Invalid item.");
    }

    const it = raw as Record<string, unknown>;

    // label
    if (!isLabel(it.label)) {
      throw new Error("Invalid label.");
    }

    // why
    const why = typeof it.why === "string" ? it.why.trim() : "";
    if (!why) throw new Error("Missing why.");

    // text from one of: text | question | cue
    const textCandidate =
      typeof it.text === "string"
        ? it.text
        : typeof it.question === "string"
        ? it.question
        : typeof it.cue === "string"
        ? it.cue
        : "";

    const text = textCandidate.trim();
    if (!text) throw new Error("Missing text.");

    // Enforce punctuation by mode at API boundary
    if (mode === "cliff") {
      if (text.includes("?")) throw new Error("Cliff cue contains '?'.");
      if (!text.endsWith(".")) throw new Error("Cliff cue must end with '.'.");
    } else {
      if (!text.endsWith("?")) throw new Error("Question must end with '?'.");
    }

    return { label: it.label, text, why };
  });

  // Optional meta from model
  const meta = isMeta(obj.meta)
    ? {
        neutrality: clamp0to100(obj.meta.neutrality),
        heat: clamp0to100(obj.meta.heat),
        support: clamp0to100(obj.meta.support)
      }
    : undefined;

  console.log({ meta }); // For debugging: see raw meta in server logs

  // Compute meter server-side, using meta if present.
  // Meter fill now reflects SUPPORT only (curved), while HEAT is exported as glow/wave decoration.
  const meter = meta ? computeMeter(meta) : undefined;

  return { mode, items, meta, meter };
}

// -----------------------------
// Route handler
// -----------------------------
export async function POST(req: Request) {
  try {
    // Parse JSON body
    const body = (await req.json()) as Body;
    const mode = parseMode(body.mode);

    // Decide whether we have paste text, extracted text, or need candidate choice
    const resolved = await resolveInput(mode, body);
    if (resolved.kind === "choice") return resolved.response;

    // Build prompt + run model
    const prompt = buildPrompt(resolved.text, mode);
    const parsed = await runModel(prompt);

    // Normalize output (includes meta + meter)
    const normalized = normalizeModelOutput(parsed, mode);

    const out: ApiOut = normalized;
    return json(200, out);
  } catch (err: unknown) {
    console.error("POST /api/questions failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return json(500, { error: "Failed to generate output.", detail: message });
  }
}
