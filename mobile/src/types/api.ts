export type Label = 'Words' | 'Proof' | 'Missing';

export type Item = {
  label: Label;
  text: string;
  why: string;
};

export type Meter = {
  value: number;
  label: 'Supported' | 'Mixed support' | 'Unsupported';
  glow?: number;
  wave?: boolean;
};

export type ExtractCandidate = {
  title: string;
  url: string;
  score: number;
  snippet: string;
};

export type Bundle = {
  fast: Item[];
  deeper: Item[];
  cliff: Item[];
};

export type AnalysisResult =
  | { type: 'result'; bundle: Bundle; meter?: Meter }
  | { type: 'choice'; sourceUrl: string; candidates: ExtractCandidate[] }
  | { type: 'error'; error: string };
