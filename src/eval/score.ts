// Deterministic graders for a diagnosis against a scenario's known truth
// (docs/ai/eval-plan.md). No model is involved, so a score is reproducible.

export interface Truth {
  kind: 'fault' | 'benign' | 'undeterminable';
  /** One list per independent fault; naming any host in a list names that fault. */
  causes: string[][];
  /** Hosts that may be named alongside the cause without penalty. */
  alsoOk: string[];
  /** Hosts whose open alerts are unrelated to the fault. */
  unrelated: string[];
}

export interface AnswerCause {
  host: string;
  what?: string;
  confidence?: string;
}

export interface Answer {
  verdict?: string;
  causes?: AnswerCause[];
  unrelated_alerts?: string[];
}

export interface Estate {
  hosts: string[];
  /** Tier name to its hosts, so that "app tier" can be read as its hosts. */
  tiers: Record<string, string[]>;
}

export interface Score {
  /** The verdict matches the kind of incident. */
  verdict: boolean;
  /** Verdict right, every fault named, and nothing else put forward as a cause. */
  causeAccuracy: boolean;
  /** Hosts blamed at high confidence that are not a cause. Must be empty. */
  falseBlame: string[];
  /** Older, unrelated alerts kept apart from the cause. */
  unrelated: 'pass' | 'fail' | 'n/a';
  notes: string[];
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Hosts a free-text host field refers to: names, ranges such as app-01..04, and tiers. */
export function hostsNamed(text: string, estate: Estate): string[] {
  const found = new Set<string>();
  const t = text.toLowerCase();
  for (const h of estate.hosts) {
    if (new RegExp(`(^|[^a-z0-9-])${esc(h.toLowerCase())}($|[^a-z0-9-])`).test(t)) found.add(h);
  }
  // app-01..04, app-01..app-04, app-01 to app-04
  for (const m of t.matchAll(/([a-z][a-z-]*?)-(\d+)\s*(?:\.\.+|to|through)\s*(?:[a-z][a-z-]*?-)?(\d+)/g)) {
    const [, prefix, from, to] = m;
    for (let n = Number(from); n <= Number(to) && n - Number(from) < 100; n++) {
      const name = `${prefix}-${String(n).padStart(from!.length, '0')}`;
      const host = estate.hosts.find((h) => h.toLowerCase() === name);
      if (host) found.add(host);
    }
  }
  for (const [tier, members] of Object.entries(estate.tiers)) {
    if (new RegExp(`\\b${esc(tier.toLowerCase())}[- ](tier|servers?|hosts?|nodes?)\\b`).test(t)) members.forEach((h) => found.add(h));
  }
  // In estate order, so results are stable.
  return estate.hosts.filter((h) => found.has(h));
}

const level = (c: AnswerCause): 'high' | 'medium' | 'low' => {
  const v = (c.confidence ?? 'medium').toLowerCase();
  return v === 'high' || v === 'low' ? v : 'medium';
};

export function score(answer: Answer, truth: Truth, estate: Estate): Score {
  const notes: string[] = [];
  const causes = (answer.causes ?? []).map((c) => ({ ...c, named: hostsNamed(c.host, estate), level: level(c) }));
  // Answers recorded before the verdict field existed have causes but no verdict.
  const verdictGiven = answer.verdict ?? (causes.length > 0 ? 'cause_found' : 'undetermined');
  const expected = { fault: 'cause_found', benign: 'benign', undeterminable: 'undetermined' }[truth.kind];
  const verdict = verdictGiven === expected;
  if (!verdict) notes.push(`verdict "${verdictGiven}", expected "${expected}"`);

  const trueHosts = new Set(truth.causes.flat());
  const acceptable = new Set([...trueHosts, ...truth.alsoOk]);
  const confident = causes.filter((c) => c.level !== 'low');

  let causeAccuracy = verdict;
  if (truth.kind === 'fault') {
    const allNamed = new Set(causes.flatMap((c) => c.named));
    truth.causes.forEach((group, i) => {
      if (!group.some((h) => allNamed.has(h))) {
        causeAccuracy = false;
        notes.push(`fault ${i + 1} not named (any of: ${group.join(', ')})`);
      }
    });
    // A confident cause that points at no true cause is a second, wrong answer.
    for (const c of confident) {
      if (!c.named.some((h) => trueHosts.has(h))) {
        causeAccuracy = false;
        notes.push(`extra cause at ${c.level} confidence: "${c.host}"`);
      }
    }
  } else if (confident.length > 0) {
    causeAccuracy = false;
    notes.push(`blames ${confident.map((c) => `"${c.host}"`).join(', ')} although there is no identifiable fault`);
  }

  const falseBlame = [...new Set(causes.filter((c) => c.level === 'high').flatMap((c) => c.named.filter((h) => !acceptable.has(h))))];
  if (falseBlame.length) notes.push(`high-confidence blame on a host that is not a cause: ${falseBlame.join(', ')}`);

  let unrelated: Score['unrelated'] = 'n/a';
  if (truth.unrelated.length > 0) {
    const listed = hostsNamed((answer.unrelated_alerts ?? []).join(' | '), estate);
    const blamed = confident.flatMap((c) => c.named);
    const missed = truth.unrelated.filter((h) => !listed.includes(h));
    const wronglyBlamed = truth.unrelated.filter((h) => blamed.includes(h));
    unrelated = missed.length === 0 && wronglyBlamed.length === 0 ? 'pass' : 'fail';
    if (missed.length) notes.push(`unrelated alert not set aside: ${missed.join(', ')}`);
    if (wronglyBlamed.length) notes.push(`unrelated host put forward as a cause: ${wronglyBlamed.join(', ')}`);
  }

  return { verdict, causeAccuracy, falseBlame, unrelated, notes };
}
