// The diagnosis: what the investigator produces, what delivery will send,
// and what the scorer reads (docs/design/diagnosis-schema.md).
import type { ToolSpec } from './llm.ts';

export type Confidence = 'high' | 'medium' | 'low';

export interface Cause {
  host: string;
  what: string;
  confidence: Confidence;
}

export interface Evidence {
  claim: string;
  /** Number of the query whose output supports the claim. */
  query: number;
}

export interface Diagnosis {
  /** 'incomplete' is set by the loop when it had to stop early; the model cannot choose it. */
  verdict: 'cause_found' | 'benign' | 'undetermined' | 'incomplete';
  causes: Cause[];
  unrelated_alerts: string[];
  ruled_out: string[];
  evidence: Evidence[];
  next_step: string;
}

const text = { type: 'string' } as const;

/** The tool the model calls to finish. Strict, so its input always has this shape. */
export const SUBMIT_DIAGNOSIS: ToolSpec = {
  name: 'submit_diagnosis',
  description: 'Submit the final diagnosis for this incident. Call exactly once, when you are done investigating.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['cause_found', 'benign', 'undetermined'] },
      causes: {
        type: 'array',
        description: 'One entry per independent fault. Empty unless the verdict is cause_found.',
        items: {
          type: 'object',
          properties: {
            host: { ...text, description: 'Host name, or a tier such as "app tier" when the same change hit every host in it.' },
            what: { ...text, description: 'One sentence: what is wrong there.' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['host', 'what', 'confidence'],
          additionalProperties: false,
        },
      },
      unrelated_alerts: { type: 'array', items: text, description: 'Open alerts that are not part of this incident, as "host: alert name".' },
      ruled_out: { type: 'array', items: text, description: 'What you checked and found healthy.' },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            claim: { ...text, description: 'A short fact with numbers and times.' },
            query: { type: 'integer', description: 'The number of the query that returned it.' },
          },
          required: ['claim', 'query'],
          additionalProperties: false,
        },
      },
      next_step: { ...text, description: 'The one check or action the engineer should do next.' },
    },
    required: ['verdict', 'causes', 'unrelated_alerts', 'ruled_out', 'evidence', 'next_step'],
    additionalProperties: false,
  },
};

const MAX = { causes: 5, list: 30, text: 600 };

/**
 * Check a submitted diagnosis. Returns the problems found, in words the model
 * can act on; an empty list means it is acceptable. `queries` is how many
 * queries have run, so that evidence can only cite a query that exists.
 */
export function validateDiagnosis(input: unknown, queries: number): string[] {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null) return ['the diagnosis must be an object'];
  const d = input as Record<string, unknown>;
  const str = (v: unknown, where: string): void => {
    if (typeof v !== 'string' || v.trim() === '') errors.push(`${where} must be a non-empty string`);
    else if (v.length > MAX.text) errors.push(`${where} is longer than ${MAX.text} characters`);
  };
  const list = (v: unknown, where: string, max: number): unknown[] => {
    if (!Array.isArray(v)) {
      errors.push(`${where} must be an array`);
      return [];
    }
    if (v.length > max) errors.push(`${where} has more than ${max} entries`);
    return v;
  };

  if (!['cause_found', 'benign', 'undetermined'].includes(d.verdict as string)) {
    errors.push('verdict must be cause_found, benign or undetermined');
  }
  const causes = list(d.causes, 'causes', MAX.causes);
  causes.forEach((c, i) => {
    const o = (typeof c === 'object' && c !== null ? c : {}) as Record<string, unknown>;
    str(o.host, `causes[${i}].host`);
    str(o.what, `causes[${i}].what`);
    if (!['high', 'medium', 'low'].includes(o.confidence as string)) errors.push(`causes[${i}].confidence must be high, medium or low`);
  });
  list(d.unrelated_alerts, 'unrelated_alerts', MAX.list).forEach((v, i) => str(v, `unrelated_alerts[${i}]`));
  const ruledOut = list(d.ruled_out, 'ruled_out', MAX.list);
  ruledOut.forEach((v, i) => str(v, `ruled_out[${i}]`));
  list(d.evidence, 'evidence', MAX.list).forEach((e, i) => {
    const o = (typeof e === 'object' && e !== null ? e : {}) as Record<string, unknown>;
    str(o.claim, `evidence[${i}].claim`);
    if (!Number.isInteger(o.query) || (o.query as number) < 1 || (o.query as number) > queries) {
      errors.push(`evidence[${i}].query must be the number of a query that ran (1 to ${queries})`);
    }
  });
  str(d.next_step, 'next_step');

  if (d.verdict === 'cause_found' && causes.length === 0) errors.push('verdict cause_found needs at least one cause');
  if ((d.verdict === 'benign' || d.verdict === 'undetermined') && causes.length > 0) {
    errors.push(`verdict ${d.verdict} must have no causes; put leads in next_step or ruled_out`);
  }
  if (d.verdict === 'undetermined' && ruledOut.length === 0) errors.push('verdict undetermined must list what was ruled out');
  return errors;
}
