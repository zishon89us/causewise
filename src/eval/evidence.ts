// Evidence validity: does each claim's cited query actually contain the
// numbers and times the claim states? A heuristic check on text, not proof
// that the reasoning is right; it catches invented or misattributed figures.

export interface EvidenceCheck {
  claim: string;
  query: number;
  /** 'unchecked': the claim states no numbers or times to verify. */
  result: 'supported' | 'unsupported' | 'unchecked';
  missing: string[];
}

interface QueryOutput {
  seq: number;
  output: string;
}

// Numbers that are part of a name (app-01, dist-sw-02, fs.root, #3) are skipped.
const NUMBER = /(?<![\w.#-])\d+(?:\.\d+)?(?![\w-]|\.\d)/g;
const TIME = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

function numbersIn(text: string): number[] {
  return [...text.replace(TIME, ' ').matchAll(NUMBER)].map((m) => Number(m[0]));
}

/** A stated number matches a source number if it could be a rounding of it. */
function close(stated: number, source: number): boolean {
  if (stated === source) return true;
  const tolerance = Math.max(0.5, Math.abs(source) * 0.05);
  return Math.abs(stated - source) <= tolerance;
}

export function checkEvidence(evidence: Array<{ claim: string; query: number }>, log: QueryOutput[]): EvidenceCheck[] {
  return evidence.map(({ claim, query }) => {
    const output = log.find((q) => q.seq === query)?.output;
    if (output === undefined) return { claim, query, result: 'unsupported', missing: ['cited query does not exist'] };

    const sourceNumbers = numbersIn(output);
    const sourceTimes = [...output.matchAll(TIME)].map((m) => m[0]);
    const missing: string[] = [];
    const times = [...claim.matchAll(TIME)].map((m) => m[0]);
    for (const t of times) {
      // 09:34 is supported by 09:34:26.
      if (!sourceTimes.some((s) => s === t || s.startsWith(`${t}:`) || t.startsWith(`${s}:`))) missing.push(t);
    }
    const numbers = numbersIn(claim);
    for (const n of numbers) if (!sourceNumbers.some((s) => close(n, s))) missing.push(String(n));

    const stated = times.length + numbers.length;
    if (stated === 0) return { claim, query, result: 'unchecked', missing: [] };
    // Claims paraphrase ("about 35%", "rose by 30 points"), so allow a minority of misses.
    return { claim, query, result: missing.length / stated <= 0.34 ? 'supported' : 'unsupported', missing };
  });
}

/** Share of checkable claims that are supported, or null when none are checkable. */
export function evidenceValidity(checks: EvidenceCheck[]): number | null {
  const checkable = checks.filter((c) => c.result !== 'unchecked');
  return checkable.length ? checkable.filter((c) => c.result === 'supported').length / checkable.length : null;
}
