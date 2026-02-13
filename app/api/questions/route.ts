// app/api/questions/route.ts
import OpenAI from "openai";
import { buildPrompt, type Mode as PromptMode } from "@/lib/prompt";

export const runtime = "nodejs";

// OpenAI client (server-side only)
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -----------------------------
// Types
// -----------------------------
type Mode = PromptMode; // prompt.ts should now include "bundle"

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
 */
type Meter = {
  value: number; // 0–100 fill (support-only, curved)
  label: "Supported" | "Mixed support" | "Unsupported";
  glow?: number; // 0–100 (heat-derived decoration)
  wave?: boolean; // true when heat is very high (e.g., > 80)
};

type NormalizedOutput = {
  mode: Exclude<Mode, "bundle">; // fast|deeper|cliff
  items: NormalizedItem[];
  meta?: Meta;
  meter?: Meter;
};

type Bundle = {
  fast: NormalizedItem[];
  deeper: NormalizedItem[];
  cliff: NormalizedItem[];
};

type BundledOutput = {
  mode: "bundle";
  bundle: Bundle;
  meta?: Meta;
  meter?: Meter;
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

type ApiOut = NormalizedOutput | BundledOutput | NeedsChoice;

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
function parseMode(raw: unknown): Mode {
  return raw === "deeper" || raw === "fast" || raw === "cliff" || raw === "bundle"
    ? raw
    : "fast";
}

function isLabel(x: unknown): x is Label {
  return x === "Words" || x === "Proof" || x === "Missing";
}

function isMeta(value: unknown): value is Meta {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.neutrality === "number" &&
    typeof v.heat === "number" &&
    typeof v.support === "number"
  );
}

function clamp0to100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

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

function needsChoice(mode: Mode, extracted: ExtractResponse): Response {
  const out: NeedsChoice = {
    mode,
    needsChoice: true,
    sourceUrl: extracted.url,
    candidates: extracted.candidates ?? []
  };
  return json(200, out);
}

function requireMinText(text: string, min = 80): string {
  const t = text.trim();
  if (t.length < min) throw new Error(`MIN_TEXT:${min}`);
  return t;
}

// -----------------------------
// Meter logic (Support fill + Heat glow)
// -----------------------------
function clampForMeter(n: number, lo = 10, hi = 95): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function meterLabel(v: number): Meter["label"] {
  if (v >= 80) return "Supported";
  if (v >= 55) return "Mixed support";
  return "Unsupported";
}

function curveSupportToFill(support: number): number {
  const s = clamp0to100(support) / 100; // 0..1
  const anchor = 0.55;
  const k = 1.0;

  const y = s + k * (s - anchor) * s * (1 - s);
  const yClamped = Math.max(0, Math.min(1, y));
  return yClamped * 100;
}

function computeMeter(meta: Meta): Meter {
  const support = clamp0to100(meta.support);
  const heat = clamp0to100(meta.heat);

  const curvedFill = curveSupportToFill(support);
  const value = clampForMeter(curvedFill, 10, 95);

  return {
    value,
    label: meterLabel(value),
    glow: heat,
    wave: heat > 80
  };
}

// -----------------------------
// URL extraction
// -----------------------------
async function extractFromUrl(url: string): Promise<ExtractResponse> {
  const extractorUrl =
    process.env.EXTRACTOR_URL ??
    "https://ask-better-questions-vrjh.onrender.com/extract";

  const r = await fetch(extractorUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-extractor-key": process.env.EXTRACTOR_KEY ?? ""
    },
    body: JSON.stringify({ url, include_candidates: true })
  });

  if (!r.ok) {
    const msg = await r.text();
     console.error("Extractor error:", r.status, msg.slice(0, 800));
    throw new Error(`Extractor failed: ${msg}`);
  }

  return (await r.json()) as ExtractResponse;
}

// -----------------------------
// Model call
// -----------------------------
async function runModel(prompt: string): Promise<unknown> {
  const resp = await client.responses.create({
    model: "gpt-5.2",
    input: prompt,
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
// Input resolution
// -----------------------------
async function resolveInput(
  mode: Mode,
  body: Body
): Promise<
  | { kind: "text"; text: string }
  | { kind: "choice"; response: Response }
> {
  const inputMode = body.inputMode === "url" ? "url" : "paste";

  if (inputMode === "paste") {
    const text = String(body.text ?? "");
    try {
      return { kind: "text", text: requireMinText(text, 80) };
    } catch {
      return {
        kind: "choice",
        response: badRequest("Paste a bit more article text (at least ~80 characters).")
      };
    }
  }

  const url = String(body.url ?? "").trim();
  const chosenUrl = String(body.chosenUrl ?? "").trim();

  if (url.length < 8) {
    return { kind: "choice", response: badRequest("Paste a valid URL.") };
  }

  const targetUrl = chosenUrl || url;
  const extracted = await extractFromUrl(targetUrl);

  if (!chosenUrl && extracted.is_multi) {
    return { kind: "choice", response: needsChoice(mode, extracted) };
  }

  const text = (extracted.text ?? "").trim();
  if (text.length < 80) {
    return {
      kind: "choice",
      response: unprocessable("Could not extract enough article text from that URL.")
    };
  }

  return { kind: "text", text };
}

// -----------------------------
// Normalization helpers
// -----------------------------
function normalizeItems(rawItems: unknown, mode: Exclude<Mode, "bundle">): NormalizedItem[] {
  if (!Array.isArray(rawItems) || rawItems.length !== 3) {
    throw new Error("Model returned unexpected shape (need 3 items).");
  }

  return rawItems.map((raw) => {
    if (typeof raw !== "object" || raw === null) throw new Error("Invalid item.");

    const it = raw as Record<string, unknown>;
    if (!isLabel(it.label)) throw new Error("Invalid label.");

    const why = typeof it.why === "string" ? it.why.trim() : "";
    if (!why) throw new Error("Missing why.");

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

    if (mode === "cliff") {
      if (text.includes("?")) throw new Error("Cliff cue contains '?'.");
      if (!text.endsWith(".")) throw new Error("Cliff cue must end with '.'.");
    } else {
      if (!text.endsWith("?")) throw new Error("Question must end with '?'.");
    }

    return { label: it.label, text, why };
  });
}

function normalizeSingle(parsed: unknown, mode: Exclude<Mode, "bundle">): NormalizedOutput {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Model returned non-object JSON.");
  }

  const obj = parsed as Record<string, unknown>;
  const rawItems = (obj.items ?? obj.questions) as unknown;

  const items = normalizeItems(rawItems, mode);

  const meta = isMeta(obj.meta)
    ? {
        neutrality: clamp0to100(obj.meta.neutrality),
        heat: clamp0to100(obj.meta.heat),
        support: clamp0to100(obj.meta.support)
      }
    : undefined;

  const meter = meta ? computeMeter(meta) : undefined;

  return { mode, items, meta, meter };
}

function normalizeBundle(parsed: unknown): BundledOutput {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Model returned non-object JSON.");
  }

  const obj = parsed as Record<string, unknown>;
  const rawBundle = obj.bundle as unknown;

  if (typeof rawBundle !== "object" || rawBundle === null) {
    throw new Error("Model returned missing/invalid bundle.");
  }

  const b = rawBundle as Record<string, unknown>;

  const fast = normalizeItems(b.fast, "fast");
  const deeper = normalizeItems(b.deeper, "deeper");
  const cliff = normalizeItems(b.cliff, "cliff");

  const meta = isMeta(obj.meta)
    ? {
        neutrality: clamp0to100(obj.meta.neutrality),
        heat: clamp0to100(obj.meta.heat),
        support: clamp0to100(obj.meta.support)
      }
    : undefined;

  const meter = meta ? computeMeter(meta) : undefined;

  return {
    mode: "bundle",
    bundle: { fast, deeper, cliff },
    meta,
    meter
  };
}

// -----------------------------
// Route handler
// -----------------------------
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const mode = parseMode(body.mode);

    const resolved = await resolveInput(mode, body);
    if (resolved.kind === "choice") return resolved.response;

    const prompt = buildPrompt(resolved.text, mode);
    const parsed = await runModel(prompt);

    const out: ApiOut =
      mode === "bundle"
        ? normalizeBundle(parsed)
        : normalizeSingle(parsed, mode);

    return json(200, out);
  } catch (err: unknown) {
    console.error("POST /api/questions failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return json(500, { error: "Failed to generate output.", detail: message });
  }
}
