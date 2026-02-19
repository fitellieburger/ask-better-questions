import type { AnalysisResult } from '../types/api';

const API_URL = 'https://ask-better-questions.onrender.com/api/questions';
const APP_HEALTH_URL = 'https://ask-better-questions.onrender.com/api/health';
const EXTRACTOR_HEALTH_URL = 'https://ask-better-questions-vrjh.onrender.com/health';

export type ProgressCallback = (stage: string) => void;

export async function pingBothServices(): Promise<boolean> {
  try {
    const [appOk, extOk] = await Promise.all([
      fetch(APP_HEALTH_URL, { signal: AbortSignal.timeout(3000) })
        .then(r => r.ok)
        .catch(() => false),
      fetch(EXTRACTOR_HEALTH_URL, { signal: AbortSignal.timeout(3000) })
        .then(r => r.ok)
        .catch(() => false),
    ]);
    return appOk && extOk;
  } catch {
    return false;
  }
}

export async function analyzeUrl(
  url: string,
  chosenUrl: string | null,
  onProgress: ProgressCallback,
  signal: AbortSignal,
): Promise<AnalysisResult> {
  const body = {
    inputMode: 'url',
    url,
    mode: 'bundle',
    ...(chosenUrl ? {chosenUrl} : {}),
  };

  let resp: Response;
  try {
    resp = await fetch(API_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    return {type: 'error', error: 'Could not reach the server.'};
  }

  if (!resp.ok) {
    return {type: 'error', error: `Server error ${resp.status}.`};
  }

  let text: string;
  try {
    text = await resp.text();
  } catch {
    return {type: 'error', error: 'Failed to read response.'};
  }

  let result: AnalysisResult | null = null;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const event = JSON.parse(trimmed);
      if (event.type === 'progress') {
        onProgress(event.stage);
      } else if (event.type === 'result') {
        result = {
          type: 'result',
          bundle: event.data.bundle,
          meter: event.data.meter,
        };
      } else if (event.type === 'choice') {
        result = {
          type: 'choice',
          sourceUrl: event.data.sourceUrl,
          candidates: event.data.candidates,
        };
      } else if (event.type === 'error') {
        result = {type: 'error', error: event.error};
      }
    } catch {
      // skip malformed lines
    }
  }

  return result ?? {type: 'error', error: 'No result received.'};
}
