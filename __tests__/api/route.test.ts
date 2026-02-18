import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist the OpenAI mock so it is available when the module is imported
// ---------------------------------------------------------------------------
const mockResponsesCreate = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  // Must be a regular function (not an arrow) so `new OpenAI()` works
  default: vi.fn(function MockOpenAI() {
    return { responses: { create: mockResponsesCreate } };
  }),
}));

import { POST } from "@/app/api/questions/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a streaming NDJSON response into an array of parsed event objects. */
async function readStream(response: Response): Promise<Record<string, unknown>[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Record<string, unknown>[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) events.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  return events;
}

/** Create a POST Request with a JSON body. */
function makeRequest(body: object): Request {
  return new Request("http://localhost/api/questions", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** Wrap model output in the shape the OpenAI Responses API returns. */
function makeModelResponse(jsonText: string) {
  return {
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: jsonText }],
      },
    ],
  };
}

const ARTICLE_TEXT =
  "The city council voted 5–4 last Tuesday to approve a new zoning ordinance. " +
  "Officials said the change would allow denser housing in three downtown districts. " +
  "Critics argued no environmental review had been completed before the vote. " +
  "The mayor signed the ordinance into law the following morning without comment.";

/** A well-formed bundle response matching the schema the route expects. */
const VALID_BUNDLE = {
  meta: { neutrality: 70, heat: 40, support: 75 },
  bundle: {
    fast: [
      { label: "Words", text: "Does the headline use a charged verb here?", why: "Charged verbs in headlines prime readers before the article begins." },
      { label: "Proof",  text: "What does the text show to back this claim?", why: "Without shown evidence, readers accept framing as established fact." },
      { label: "Missing", text: "What standard or comparison is left out?", why: "Absent benchmarks make it hard to gauge the significance claimed." },
    ],
    deeper: [
      { label: "Words", text: "Which label or phrasing steers the reader's first impression here?", why: "Early framing anchors how readers interpret everything that follows." },
      { label: "Proof",  text: "What specific evidence does the article provide for its central claim?", why: "Concrete evidence lets readers evaluate rather than simply accept." },
      { label: "Missing", text: "What scope or limit on the story's claim goes unstated by the author?", why: "Without limits, readers may generalise beyond what the text shows." },
    ],
    cliff: [
      { label: "Words",   text: "The author frames the vote with evaluative language.", why: "Evaluative framing signals interpretation before evidence appears." },
      { label: "Proof",   text: "Key claims rest on official statements, not records.", why: "Official statements may differ from documented outcomes." },
      { label: "Missing", text: "No dissenting expert voice is included.", why: "One-sided sourcing limits the reader's ability to judge independently." },
    ],
  },
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Default fetch stub — fails loudly if called unexpectedly
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected fetch call")));
  mockResponsesCreate.mockReset();
  mockResponsesCreate.mockRejectedValue(new Error("OpenAI not mocked for this test"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Response format
// ---------------------------------------------------------------------------

describe("POST /api/questions — response format", () => {
  it("always returns HTTP 200 with Content-Type application/x-ndjson", async () => {
    mockResponsesCreate.mockResolvedValue(makeModelResponse(JSON.stringify(VALID_BUNDLE)));
    const res = await POST(makeRequest({ inputMode: "paste", text: ARTICLE_TEXT, mode: "bundle" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");
  });

  it("emits at least one progress event before the result", async () => {
    mockResponsesCreate.mockResolvedValue(makeModelResponse(JSON.stringify(VALID_BUNDLE)));
    const events = await readStream(
      await POST(makeRequest({ inputMode: "paste", text: ARTICLE_TEXT, mode: "bundle" }))
    );

    const types = events.map((e) => e.type);
    const resultIdx = types.lastIndexOf("result");
    const progressIdx = types.indexOf("progress");
    expect(progressIdx).toBeGreaterThanOrEqual(0);
    expect(progressIdx).toBeLessThan(resultIdx);
  });

  it("the result event is always the last event in the stream", async () => {
    mockResponsesCreate.mockResolvedValue(makeModelResponse(JSON.stringify(VALID_BUNDLE)));
    const events = await readStream(
      await POST(makeRequest({ inputMode: "paste", text: ARTICLE_TEXT, mode: "bundle" }))
    );

    expect(events.at(-1)?.type).toBe("result");
  });
});

// ---------------------------------------------------------------------------
// Paste mode — input validation
// ---------------------------------------------------------------------------

describe("POST /api/questions — paste mode validation", () => {
  it("streams an error for text shorter than 80 characters", async () => {
    const events = await readStream(
      await POST(makeRequest({ inputMode: "paste", text: "Too short.", mode: "bundle" }))
    );

    expect(events).toContainEqual(
      expect.objectContaining({ type: "error", error: expect.stringContaining("80 characters") })
    );
  });

  it("streams an error for empty text", async () => {
    const events = await readStream(
      await POST(makeRequest({ inputMode: "paste", text: "", mode: "bundle" }))
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "error" }));
  });

  it("proceeds to result for text at exactly 80 trimmed characters", async () => {
    mockResponsesCreate.mockResolvedValue(makeModelResponse(JSON.stringify(VALID_BUNDLE)));
    const text = "A".repeat(80);
    const events = await readStream(
      await POST(makeRequest({ inputMode: "paste", text, mode: "bundle" }))
    );

    expect(events.map((e) => e.type)).toContain("result");
  });
});

// ---------------------------------------------------------------------------
// Paste mode — successful bundle response
// ---------------------------------------------------------------------------

describe("POST /api/questions — paste mode bundle result", () => {
  it("result contains mode=bundle and three item sets", async () => {
    mockResponsesCreate.mockResolvedValue(makeModelResponse(JSON.stringify(VALID_BUNDLE)));
    const events = await readStream(
      await POST(makeRequest({ inputMode: "paste", text: ARTICLE_TEXT, mode: "bundle" }))
    );

    const result = events.find((e) => e.type === "result") as { data: Record<string, unknown> } | undefined;
    expect(result).toBeDefined();
    expect(result!.data.mode).toBe("bundle");

    const bundle = result!.data.bundle as Record<string, unknown[]>;
    expect(bundle.fast).toHaveLength(3);
    expect(bundle.deeper).toHaveLength(3);
    expect(bundle.cliff).toHaveLength(3);
  });

  it("result includes meta with neutrality, heat, support", async () => {
    mockResponsesCreate.mockResolvedValue(makeModelResponse(JSON.stringify(VALID_BUNDLE)));
    const events = await readStream(
      await POST(makeRequest({ inputMode: "paste", text: ARTICLE_TEXT, mode: "bundle" }))
    );

    const result = events.find((e) => e.type === "result") as { data: Record<string, unknown> } | undefined;
    const meta = result!.data.meta as Record<string, number>;
    expect(typeof meta.neutrality).toBe("number");
    expect(typeof meta.heat).toBe("number");
    expect(typeof meta.support).toBe("number");
  });

  it("result includes a meter object", async () => {
    mockResponsesCreate.mockResolvedValue(makeModelResponse(JSON.stringify(VALID_BUNDLE)));
    const events = await readStream(
      await POST(makeRequest({ inputMode: "paste", text: ARTICLE_TEXT, mode: "bundle" }))
    );

    const result = events.find((e) => e.type === "result") as { data: Record<string, unknown> } | undefined;
    expect(result!.data.meter).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// URL mode — input validation
// ---------------------------------------------------------------------------

describe("POST /api/questions — url mode validation", () => {
  it("streams an error for a URL shorter than 8 characters", async () => {
    const events = await readStream(
      await POST(makeRequest({ inputMode: "url", url: "http://", mode: "bundle" }))
    );

    expect(events).toContainEqual({ type: "error", error: "Paste a valid URL." });
  });

  it("streams an error when the extractor returns too little text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        url: "https://example.com/article",
        chosen_url: "",
        title: "Article",
        text: "Short.",
        is_multi: false,
        candidates: [],
      }),
    }));

    const events = await readStream(
      await POST(makeRequest({ inputMode: "url", url: "https://example.com/article", mode: "bundle" }))
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "error" }));
  });

  it("streams an error when the extractor itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal server error"),
    }));

    const events = await readStream(
      await POST(makeRequest({ inputMode: "url", url: "https://example.com/article", mode: "bundle" }))
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "error" }));
  });
});

// ---------------------------------------------------------------------------
// URL mode — multi-story hub pages
// ---------------------------------------------------------------------------

describe("POST /api/questions — hub page (needsChoice)", () => {
  it("sends a choice event when the extractor signals is_multi=true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        url: "https://example.com",
        chosen_url: "",
        title: "Example",
        text: "",
        is_multi: true,
        candidates: [
          { title: "Story 1", url: "https://example.com/1", score: 10, snippet: "A story." },
          { title: "Story 2", url: "https://example.com/2", score: 8,  snippet: "Another." },
        ],
      }),
    }));

    const events = await readStream(
      await POST(makeRequest({ inputMode: "url", url: "https://example.com", mode: "bundle" }))
    );

    const choice = events.find((e) => e.type === "choice") as Record<string, unknown> | undefined;
    expect(choice).toBeDefined();
    const data = choice!.data as Record<string, unknown>;
    expect(data.needsChoice).toBe(true);
    expect((data.candidates as unknown[]).length).toBe(2);
  });

  it("bypasses multi-story check when chosenUrl is provided", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        url: "https://example.com/1",
        chosen_url: "https://example.com/1",
        title: "Story 1",
        text: ARTICLE_TEXT,
        is_multi: true, // extractor still says multi, but chosenUrl overrides
        candidates: [],
      }),
    }));
    mockResponsesCreate.mockResolvedValue(makeModelResponse(JSON.stringify(VALID_BUNDLE)));

    const events = await readStream(
      await POST(makeRequest({
        inputMode: "url",
        url: "https://example.com",
        chosenUrl: "https://example.com/1",
        mode: "bundle",
      }))
    );

    expect(events.map((e) => e.type)).toContain("result");
    expect(events.map((e) => e.type)).not.toContain("choice");
  });
});

// ---------------------------------------------------------------------------
// URL mode — successful result
// ---------------------------------------------------------------------------

describe("POST /api/questions — url mode successful result", () => {
  it("streams a result when the extractor returns enough text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        url: "https://example.com/article",
        chosen_url: "",
        title: "Article",
        text: ARTICLE_TEXT,
        is_multi: false,
        candidates: [],
      }),
    }));
    mockResponsesCreate.mockResolvedValue(makeModelResponse(JSON.stringify(VALID_BUNDLE)));

    const events = await readStream(
      await POST(makeRequest({ inputMode: "url", url: "https://example.com/article", mode: "bundle" }))
    );

    expect(events.map((e) => e.type)).toContain("result");
  });
});

// ---------------------------------------------------------------------------
// Meter computation
// ---------------------------------------------------------------------------

describe("POST /api/questions — meter computation", () => {
  async function getMeter(meta: { neutrality: number; heat: number; support: number }) {
    const bundle = { ...VALID_BUNDLE, meta };
    mockResponsesCreate.mockResolvedValue(makeModelResponse(JSON.stringify(bundle)));
    const events = await readStream(
      await POST(makeRequest({ inputMode: "paste", text: ARTICLE_TEXT, mode: "bundle" }))
    );
    const result = events.find((e) => e.type === "result") as { data: Record<string, unknown> } | undefined;
    return result!.data.meter as Record<string, unknown>;
  }

  it('labels high-support article as "Supported"', async () => {
    const meter = await getMeter({ neutrality: 80, heat: 30, support: 90 });
    expect(meter.label).toBe("Supported");
  });

  it('labels mid-range article as "Mixed support"', async () => {
    const meter = await getMeter({ neutrality: 60, heat: 50, support: 60 });
    expect(meter.label).toBe("Mixed support");
  });

  it('labels low-support article as "Unsupported"', async () => {
    const meter = await getMeter({ neutrality: 30, heat: 70, support: 15 });
    expect(meter.label).toBe("Unsupported");
  });

  it("sets wave=true when heat > 80", async () => {
    const meter = await getMeter({ neutrality: 70, heat: 90, support: 70 });
    expect(meter.wave).toBe(true);
  });

  it("sets wave=false when heat <= 80", async () => {
    const meter = await getMeter({ neutrality: 70, heat: 60, support: 70 });
    expect(meter.wave).toBe(false);
  });

  it("clamps meter fill value between 10 and 95", async () => {
    // Extreme support values
    for (const support of [0, 100]) {
      const meter = await getMeter({ neutrality: 50, heat: 50, support });
      expect(meter.value as number).toBeGreaterThanOrEqual(10);
      expect(meter.value as number).toBeLessThanOrEqual(95);
    }
  });
});

// ---------------------------------------------------------------------------
// Meta score clamping
// ---------------------------------------------------------------------------

describe("POST /api/questions — meta score clamping", () => {
  it("clamps out-of-range meta scores to 0–100", async () => {
    const bundle = { ...VALID_BUNDLE, meta: { neutrality: 150, heat: -10, support: 999 } };
    mockResponsesCreate.mockResolvedValue(makeModelResponse(JSON.stringify(bundle)));
    const events = await readStream(
      await POST(makeRequest({ inputMode: "paste", text: ARTICLE_TEXT, mode: "bundle" }))
    );

    const result = events.find((e) => e.type === "result") as { data: Record<string, unknown> } | undefined;
    const meta = result!.data.meta as Record<string, number>;
    expect(meta.neutrality).toBe(100);
    expect(meta.heat).toBe(0);
    expect(meta.support).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Normalization — cliff cues
// ---------------------------------------------------------------------------

describe("POST /api/questions — cliff cue validation", () => {
  it("rejects cliff cues that contain '?'", async () => {
    const bad = {
      ...VALID_BUNDLE,
      bundle: {
        ...VALID_BUNDLE.bundle,
        cliff: [
          { label: "Words",   text: "Is this a question?",                          why: "Testing." },
          { label: "Proof",   text: "Key claims rest on official statements.",        why: "Testing." },
          { label: "Missing", text: "No dissenting expert voice is included.",        why: "Testing." },
        ],
      },
    };
    mockResponsesCreate.mockResolvedValue(makeModelResponse(JSON.stringify(bad)));
    const events = await readStream(
      await POST(makeRequest({ inputMode: "paste", text: ARTICLE_TEXT, mode: "bundle" }))
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "error" }));
  });

  it("rejects cliff cues that do not end with '.'", async () => {
    const bad = {
      ...VALID_BUNDLE,
      bundle: {
        ...VALID_BUNDLE.bundle,
        cliff: [
          { label: "Words",   text: "The author frames events with evaluative language",  why: "Testing." },
          { label: "Proof",   text: "Key claims rest on official statements.",             why: "Testing." },
          { label: "Missing", text: "No dissenting expert voice is included.",             why: "Testing." },
        ],
      },
    };
    mockResponsesCreate.mockResolvedValue(makeModelResponse(JSON.stringify(bad)));
    const events = await readStream(
      await POST(makeRequest({ inputMode: "paste", text: ARTICLE_TEXT, mode: "bundle" }))
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "error" }));
  });
});

// ---------------------------------------------------------------------------
// Normalization — question items
// ---------------------------------------------------------------------------

describe("POST /api/questions — question item validation", () => {
  it("rejects fast items that do not end with '?'", async () => {
    const bad = {
      ...VALID_BUNDLE,
      bundle: {
        ...VALID_BUNDLE.bundle,
        fast: [
          { label: "Words",   text: "This statement does not end with a question mark.",  why: "Testing." },
          { label: "Proof",   text: "What does the text show to back this claim?",        why: "Testing." },
          { label: "Missing", text: "What standard or comparison is left out?",           why: "Testing." },
        ],
      },
    };
    mockResponsesCreate.mockResolvedValue(makeModelResponse(JSON.stringify(bad)));
    const events = await readStream(
      await POST(makeRequest({ inputMode: "paste", text: ARTICLE_TEXT, mode: "bundle" }))
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "error" }));
  });

  it("rejects items with an invalid label", async () => {
    const bad = {
      ...VALID_BUNDLE,
      bundle: {
        ...VALID_BUNDLE.bundle,
        fast: [
          { label: "Facts",   text: "Does the headline use a charged verb here?",  why: "Testing." },
          { label: "Proof",   text: "What does the text show to back this claim?", why: "Testing." },
          { label: "Missing", text: "What standard or comparison is left out?",    why: "Testing." },
        ],
      },
    };
    mockResponsesCreate.mockResolvedValue(makeModelResponse(JSON.stringify(bad)));
    const events = await readStream(
      await POST(makeRequest({ inputMode: "paste", text: ARTICLE_TEXT, mode: "bundle" }))
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "error" }));
  });

  it("rejects a set with fewer than 3 items", async () => {
    const bad = {
      ...VALID_BUNDLE,
      bundle: {
        ...VALID_BUNDLE.bundle,
        fast: [
          { label: "Words", text: "Does the headline use a charged verb here?", why: "Testing." },
        ],
      },
    };
    mockResponsesCreate.mockResolvedValue(makeModelResponse(JSON.stringify(bad)));
    const events = await readStream(
      await POST(makeRequest({ inputMode: "paste", text: ARTICLE_TEXT, mode: "bundle" }))
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "error" }));
  });
});

// ---------------------------------------------------------------------------
// OpenAI failure handling
// ---------------------------------------------------------------------------

describe("POST /api/questions — OpenAI failure handling", () => {
  it("streams an error event when the model throws", async () => {
    mockResponsesCreate.mockRejectedValue(new Error("Rate limit exceeded"));
    const events = await readStream(
      await POST(makeRequest({ inputMode: "paste", text: ARTICLE_TEXT, mode: "bundle" }))
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "error" }));
  });

  it("streams an error when the model returns malformed JSON", async () => {
    mockResponsesCreate.mockResolvedValue(makeModelResponse("{ not valid json"));
    const events = await readStream(
      await POST(makeRequest({ inputMode: "paste", text: ARTICLE_TEXT, mode: "bundle" }))
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "error" }));
  });

  it("streams an error when the model returns an empty bundle", async () => {
    mockResponsesCreate.mockResolvedValue(makeModelResponse(JSON.stringify({ meta: VALID_BUNDLE.meta })));
    const events = await readStream(
      await POST(makeRequest({ inputMode: "paste", text: ARTICLE_TEXT, mode: "bundle" }))
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "error" }));
  });

  it("does not throw uncaught exceptions — always returns a 200 stream", async () => {
    mockResponsesCreate.mockRejectedValue(new Error("Catastrophic failure"));
    const res = await POST(makeRequest({ inputMode: "paste", text: ARTICLE_TEXT, mode: "bundle" }));

    expect(res.status).toBe(200);
    const events = await readStream(res);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });
});
