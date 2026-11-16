// The golden dataset: which scenarios are replayed as incidents, in what
// order, and with which twist. `hideTags` means the investigator is not shown
// host tags, as on an estate where nobody recorded topology.
import { scenarios } from './scenarios.mjs';

const M0 = scenarios.slice(0, 10).map((s) => ({ scenario: s.name }));

const plain = scenarios.map((s) => ({ scenario: s.name }));
const untagged = ['switch-uplink-down', 'hypervisor-cpu-contention', 'storage-latency', 'hypervisor-02-contention'].map(
  (scenario) => ({ scenario, hideTags: true }),
);

// Fixed interleaving so that a scenario and its untagged variant are apart
// and the incident number says nothing about the scenario.
const ORDER = [12, 3, 20, 7, 16, 0, 22, 10, 5, 18, 14, 1, 23, 9, 19, 4, 13, 21, 8, 15, 2, 17, 6, 11];
const all = [...plain, ...untagged];
const GOLDEN = ORDER.map((i) => all[i]);

export const datasets = { m0: M0, golden: GOLDEN };

export function resolve(name) {
  const set = datasets[name];
  if (!set) throw new Error(`unknown dataset: ${name}`);
  return set.map((entry, n) => {
    const index = scenarios.findIndex((s) => s.name === entry.scenario);
    return { id: `INC-${String(n + 1).padStart(2, '0')}`, index, hideTags: Boolean(entry.hideTags), ...scenarios[index] };
  });
}
