import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEvidence, evidenceValidity } from '../src/eval/evidence.ts';

const log = [
  { seq: 1, output: 'Open problems as of 03:07:58 UTC (16), oldest first:\n03:04:00 (4m ago)  average  nas-01  High storage latency' },
  { seq: 4, output: 'nas-01 nas.latency.ms: 12 samples\n03:01:00 (7m ago)  4.2\n03:02:00 (6m ago)  125.7\n03:03:00 (5m ago)  118.4' },
];
const one = (claim: string, query: number) => checkEvidence([{ claim, query }], log)[0]!;

test('a claim whose numbers and times are in the cited output is supported', () => {
  assert.equal(one('nas-01 latency went from 4.2 ms to 125.7 ms at 03:02', 4).result, 'supported');
});

test('rounded figures count', () => {
  assert.equal(one('latency jumped from about 4 ms to about 126 ms at 03:02:00', 4).result, 'supported');
});

test('numbers that are not in the cited output make the claim unsupported', () => {
  const c = one('latency reached 900 ms at 02:15', 4);
  assert.equal(c.result, 'unsupported');
  assert.deepEqual(c.missing, ['02:15', '900']);
});

test('citing the wrong query is caught', () => {
  assert.equal(one('nas-01 latency went from 4.2 ms to 125.7 ms', 1).result, 'unsupported');
  assert.deepEqual(one('anything 5', 9).missing, ['cited query does not exist']);
});

test('numbers inside host names and metric keys are not treated as figures', () => {
  assert.equal(one('app-01 and dist-sw-02 are behind web-03; fs.root is fine', 4).result, 'unchecked');
});

test('one loose figure among several does not fail a claim', () => {
  assert.equal(one('latency was 4.2 at 03:01, 125.7 at 03:02 and 118.4 at 03:03, roughly 30 times normal', 4).result, 'supported');
});

test('validity is the share of checkable claims that are supported', () => {
  const checks = checkEvidence(
    [{ claim: 'latency 125.7 at 03:02', query: 4 }, { claim: 'latency 900', query: 4 }, { claim: 'the database looks healthy', query: 4 }],
    log,
  );
  assert.equal(evidenceValidity(checks), 0.5);
  assert.equal(evidenceValidity(checkEvidence([{ claim: 'healthy', query: 4 }], log)), null);
});
