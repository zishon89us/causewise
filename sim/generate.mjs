// Turn a scenario into a list of timed samples: {host, key, value, t}, where t
// is seconds relative to the start of the fault. Deterministic for a seed.
import { hosts } from './topology.mjs';
import { scenarios, TIMELINE as T } from './scenarios.mjs';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_SEED = 20261116;

export function generate(n, seed = DEFAULT_SEED, from = T.start, to = T.end) {
  const sc = scenarios[n];
  const rnd = mulberry32(seed + n * 7919);
  const values = [];
  for (const h of hosts) {
    for (const item of h.items) {
      // Each check has its own phase, as real checks do.
      const phase = Math.floor(rnd() * item.interval);
      for (let t = T.start + phase; t <= T.end; t += item.interval) {
        // After the fault ends everything returns to baseline.
        const v = t < T.faultEnds ? sc.effect(h.name, item.key, t, rnd) : undefined;
        if (v === null) continue;
        const value = v === undefined ? item.base + (rnd() * 2 - 1) * item.noise : v;
        if (t >= from && t <= to) values.push({ host: h.name, key: item.key, value: Math.round(value * 100) / 100, t });
      }
    }
  }
  return values.sort((a, b) => a.t - b.t);
}
