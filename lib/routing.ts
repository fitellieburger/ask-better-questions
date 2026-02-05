// lib/routing.ts
export type RouteTag =
  | "ANONYMOUS_SOURCES"
  | "DATA_NUMBERS"
  | "HIGH_EMOTION"
  | "POLICY_PROCESS"
  | "DEFAULT";

export function detectRouteTags(text: string): RouteTag[] {
  const t = text.toLowerCase();
  const tags: RouteTag[] = [];

  const hasAnonymous =
    /\banonymous\b|\bnot authorized\b|\brequested anonymity\b|\bspeaking on condition\b/.test(t);
  if (hasAnonymous) tags.push("ANONYMOUS_SOURCES");

  const hasNumbers =
    /\b\d{1,3}(,\d{3})*(\.\d+)?\b/.test(t) || /\bpercent\b|\b%\b|\brate\b|\bper\b|\bdata\b|\bstudy\b/.test(t);
  if (hasNumbers) tags.push("DATA_NUMBERS");

  const hasHighEmotion =
    /\bshocking\b|\boutrage\b|\bterrifying\b|\bdisgusting\b|\bheartbreaking\b|\bchaos\b|\bslams\b|\bexplodes\b/.test(t);
  if (hasHighEmotion) tags.push("HIGH_EMOTION");

  const hasPolicy =
    /\bpolicy\b|\bbill\b|\blaw\b|\bregulation\b|\bagency\b|\bdepartment\b|\bcourt\b|\benforcement\b|\bexecutive order\b/.test(t);
  if (hasPolicy) tags.push("POLICY_PROCESS");

  return tags.length ? tags : ["DEFAULT"];
}

export type QuestionStyle = {
  name: string;
  instructions: string;
};

export function chooseStyle(tags: RouteTag[]): QuestionStyle {
  // Priority: policy/process > anonymous > numbers > emotion > default
  if (tags.includes("POLICY_PROCESS")) {
    return {
      name: "Policy/process",
      instructions:
        "Focus the questions on implementation details, accountability, tradeoffs, and decision points. Avoid partisan cues."
    };
  }
  if (tags.includes("ANONYMOUS_SOURCES")) {
    return {
      name: "Anonymous sourcing",
      instructions:
        "Include at least one question that probes credibility standards, incentives for anonymity, and what would independently corroborate key claims."
    };
  }
  if (tags.includes("DATA_NUMBERS")) {
    return {
      name: "Numbers/data",
      instructions:
        "Include at least one question that checks denominators, baselines, comparisons, and what data would falsify the central numeric claim."
    };
  }
  if (tags.includes("HIGH_EMOTION")) {
    return {
      name: "Emotion",
      instructions:
        "Include at least one question that separates emotional reaction from factual claims and asks what new evidence would change the reader’s judgment."
    };
  }
  return {
    name: "Default",
    instructions:
      "Use broadly applicable media-literacy questions: verify key claim, inspect framing/omission, and analyze incentives/power/agency."
  };
}
