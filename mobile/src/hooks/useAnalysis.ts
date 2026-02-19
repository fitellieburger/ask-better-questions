import {useCallback, useRef, useState} from 'react';
import {pingBothServices, analyzeUrl} from '../api/questions';
import type {Bundle, ExtractCandidate, Meter} from '../types/api';

export type Phase =
  | {kind: 'idle'}
  | {kind: 'warmup'; stage: string}
  | {kind: 'loading'; stage: string}
  | {kind: 'choice'; candidates: ExtractCandidate[]; sourceUrl: string}
  | {kind: 'result'; bundle: Bundle; meter?: Meter}
  | {kind: 'error'; message: string};

export function useAnalysis() {
  const [phase, setPhase] = useState<Phase>({kind: 'idle'});
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (url: string, chosenUrl: string | null = null) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase({kind: 'warmup', stage: 'Starting up…'});

    let warmupSkipped = false;

    // Ping both services — if both respond in 3s, skip warmup entirely
    pingBothServices().then(alive => {
      if (alive && !warmupSkipped) {
        warmupSkipped = true;
        setPhase({kind: 'loading', stage: 'Fetching page…'});
      }
    });

    // After 5s, switch warmup stage to "Waking up server…" if still waiting
    const wakeTimer = setTimeout(() => {
      setPhase(p =>
        p.kind === 'warmup' ? {kind: 'warmup', stage: 'Waking up server…'} : p,
      );
    }, 5000);

    try {
      const result = await analyzeUrl(
        url,
        chosenUrl,
        stage => {
          warmupSkipped = true;
          clearTimeout(wakeTimer);
          setPhase({kind: 'loading', stage});
        },
        controller.signal,
      );

      clearTimeout(wakeTimer);

      if (result.type === 'result') {
        setPhase({kind: 'result', bundle: result.bundle, meter: result.meter});
      } else if (result.type === 'choice') {
        setPhase({
          kind: 'choice',
          candidates: result.candidates,
          sourceUrl: result.sourceUrl,
        });
      } else {
        setPhase({kind: 'error', message: result.error});
      }
    } catch (e: unknown) {
      clearTimeout(wakeTimer);
      if (e instanceof Error && e.name === 'AbortError') {
        return;
      }
      setPhase({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Unknown error.',
      });
    }
  }, []);

  return {phase, run};
}
