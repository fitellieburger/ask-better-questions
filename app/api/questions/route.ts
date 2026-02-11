// app/api/questions/route.ts
import OpenAI from "openai";
import { buildPrompt, type Mode as PromptMode } from "@/lib/prompt";

export const runtime = "nodejs";

// OpenAI client (server-side only)
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -----------------------------
// Types
// -----------------------------
type Mode = PromptMode | "bundle";

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
  mode: Exclude<Mode, "bundle">;
  items: NormalizedItem[];
  meta?: Meta;
  meter?: Meter;
};

type BundleSet = { items: NormalizedItem[] };

type BundledOutput = {
  mode: "bundle";
  // Back-compat: keep "items" so old UI doesn’t break (defaults to fast set).
  items: NormalizedItem[];
  sets: {
    fast: BundleSet;
    deeper: BundleSet;
    cliff: BundleSet;
  };
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
  if (raw === "bundle") return "bundle";
  return raw === "deeper" || raw === "fast" || raw === "cliff" ? raw : "fast";
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

/**
 * Support -> fill curve (support-only)
 *
 * Goals:
 * - Preserve intuitive mapping: 55 support should look ~55% (not 25%).
 * - Gentle separation in 60–85 range (human nuance).
 * - Monotonic & bounded.
 */
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
    glow: heat, // raw heat
    wave: heat > 80
  };
}

// -----------------------------
// URL extraction (calls your Python microservice)
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
// Normalization (single-set)
// -----------------------------
function normalizeItemsOnly(parsed: unknown, mode: Exclude<Mode, "bundle">): { items: NormalizedItem[]; meta?: Meta } {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Model returned non-object JSON.");
  }

  const obj = parsed as Record<string, unknown>;
  const rawItems = (obj.items ?? obj.questions) as unknown;

  if (!Array.isArray(rawItems) || rawItems.length !== 3) {
    throw new Error("Model returned unexpected shape (need 3 items).");
  }

  const items: NormalizedItem[] = rawItems.map((raw) => {
    if (typeof raw !== "object" || raw === null) {
      throw new Error("Invalid item.");
    }

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

  const meta = isMeta(obj.meta)
    ? {
        neutrality: clamp0to100(obj.meta.neutrality),
        heat: clamp0to100(obj.meta.heat),
        support: clamp0to100(obj.meta.support)
      }
    : undefined;

  return { items, meta };
}

function normalizeModelOutput(parsed: unknown, mode: Exclude<Mode, "bundle">): NormalizedOutput {
  const { items, meta } = normalizeItemsOnly(parsed, mode);
  const meter = meta ? computeMeter(meta) : undefined;
  return { mode, items, meta, meter };
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

    // ✅ Bundle mode: 3 runs, 1 response (back-compat + future-friendly `sets`)
    if (mode === "bundle") {
      const [fastParsed, deeperParsed, cliffParsed] = await Promise.all([
        runModel(buildPrompt(resolved.text, "fast")),
        runModel(buildPrompt(resolved.text, "deeper")),
        runModel(buildPrompt(resolved.text, "cliff"))
      ]);

      const fast = normalizeItemsOnly(fastParsed, "fast");
      const deeper = normalizeItemsOnly(deeperParsed, "deeper");
      const cliff = normalizeItemsOnly(cliffParsed, "cliff");

      // Use fast meta as canonical (your prompt rules should make them align anyway).
      const meta = fast.meta;
      const meter = meta ? computeMeter(meta) : undefined;

      // Optional sanity logging if meta diverges across modes.
      if (fast.meta && deeper.meta) {
        const d =
          Math.abs(fast.meta.support - deeper.meta.support) +
          Math.abs(fast.meta.heat - deeper.meta.heat) +
          Math.abs(fast.meta.neutrality - deeper.meta.neutrality);
        if (d >= 15) console.warn("Bundle meta differs (fast vs deeper):", { fast: fast.meta, deeper: deeper.meta });
      }
      if (fast.meta && cliff.meta) {
        const d =
          Math.abs(fast.meta.support - cliff.meta.support) +
          Math.abs(fast.meta.heat - cliff.meta.heat) +
          Math.abs(fast.meta.neutrality - cliff.meta.neutrality);
        if (d >= 15) console.warn("Bundle meta differs (fast vs cliff):", { fast: fast.meta, cliff: cliff.meta });
      }

      const out: ApiOut = {
        mode: "bundle",
        items: fast.items, // back-compat default
        sets: {
          fast: { items: fast.items },
          deeper: { items: deeper.items },
          cliff: { items: cliff.items }
        },
        meta,
        meter
      };

      return json(200, out);
    }

    // ✅ Single-mode (existing behavior)
    const prompt = buildPrompt(resolved.text, mode);
    const parsed = await runModel(prompt);
    const normalized = normalizeModelOutput(parsed, mode);

    const out: ApiOut = normalized;
    return json(200, out);
  } catch (err: unknown) {
    console.error("POST /api/questions failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return json(500, { error: "Failed to generate output.", detail: message });
  }
}
