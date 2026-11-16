import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostsNamed, score, type Estate, type Truth } from '../src/eval/score.ts';

const APP = ['app-01', 'app-02', 'app-03', 'app-04'];
const estate: Estate = {
  hosts: [...APP, 'web-01', 'web-02', 'db-01', 'db-02', 'cache-01', 'dns-01', 'hv-01', 'nas-01', 'dist-sw-02', 'core-rtr-01', 'lb-01'],
  tiers: { app: APP, web: ['web-01', 'web-02'], db: ['db-01', 'db-02'] },
};
const fault = (causes: string[][], extra: Partial<Truth> = {}): Truth => ({ kind: 'fault', causes, alsoOk: [], unrelated: [], ...extra });

test('host names are read out of free text', () => {
  assert.deepEqual(hostsNamed('dist-sw-02 (core-rtr-01 link to dist-sw-02)', estate), ['dist-sw-02', 'core-rtr-01']);
  assert.deepEqual(hostsNamed('app tier (app-01..app-04), release 412->413 rollout', estate), APP);
  assert.deepEqual(hostsNamed('app-01..04', estate), APP);
  assert.deepEqual(hostsNamed('app-01 to app-03', estate), ['app-01', 'app-02', 'app-03']);
  assert.deepEqual(hostsNamed('Web tier', estate), ['web-01', 'web-02']);
  assert.deepEqual(hostsNamed('db-010 and xdb-01', estate), [], 'no partial matches');
  assert.deepEqual(hostsNamed('the application', estate), []);
});

test('naming the cause is correct, at any confidence', () => {
  for (const confidence of ['high', 'medium', 'low']) {
    const s = score({ verdict: 'cause_found', causes: [{ host: 'nas-01', confidence }] }, fault([['nas-01']]), estate);
    assert.deepEqual([s.verdict, s.causeAccuracy, s.falseBlame], [true, true, []]);
  }
});

test('blaming a symptom is wrong, and at high confidence it is false blame', () => {
  const medium = score({ verdict: 'cause_found', causes: [{ host: 'db-01', confidence: 'medium' }] }, fault([['nas-01']]), estate);
  assert.deepEqual([medium.causeAccuracy, medium.falseBlame], [false, []]);
  const high = score({ verdict: 'cause_found', causes: [{ host: 'db-01', confidence: 'high' }] }, fault([['nas-01']]), estate);
  assert.deepEqual([high.causeAccuracy, high.falseBlame], [false, ['db-01']]);
});

test('the right cause plus a confident wrong one is not accurate; plus a low-confidence aside it is', () => {
  const truth = fault([['lb-01']]);
  const extra = score({ causes: [{ host: 'lb-01', confidence: 'high' }, { host: 'db-02', confidence: 'medium' }] }, truth, estate);
  assert.equal(extra.causeAccuracy, false);
  const aside = score({ causes: [{ host: 'lb-01', confidence: 'medium' }, { host: 'db-02', confidence: 'low' }] }, truth, estate);
  assert.equal(aside.causeAccuracy, true);
});

test('independent faults must all be named', () => {
  const truth = fault([['dns-01'], APP]);
  assert.equal(score({ causes: [{ host: 'dns-01' }] }, truth, estate).causeAccuracy, false);
  assert.equal(score({ causes: [{ host: 'dns-01' }, { host: 'app tier' }] }, truth, estate).causeAccuracy, true);
});

test('a host listed as also acceptable can be named with the cause without penalty', () => {
  const truth = fault([['dist-sw-02']], { alsoOk: ['core-rtr-01'] });
  const s = score({ causes: [{ host: 'core-rtr-01 / dist-sw-02', confidence: 'high' }] }, truth, estate);
  assert.deepEqual([s.causeAccuracy, s.falseBlame], [true, []]);
  assert.equal(score({ causes: [{ host: 'core-rtr-01', confidence: 'high' }] }, truth, estate).causeAccuracy, false, 'but not instead of it');
});

test('a host the scorer cannot recognise counts as a wrong cause when confident', () => {
  const s = score({ causes: [{ host: 'the firewall', confidence: 'medium' }] }, fault([['nas-01']]), estate);
  assert.equal(s.causeAccuracy, false);
});

test('benign and undeterminable incidents need the matching verdict and no confident blame', () => {
  const benign: Truth = { kind: 'benign', causes: [], alsoOk: [], unrelated: [] };
  assert.equal(score({ verdict: 'benign', causes: [] }, benign, estate).causeAccuracy, true);
  assert.equal(score({ verdict: 'cause_found', causes: [{ host: 'web-02', confidence: 'low' }] }, benign, estate).causeAccuracy, false);
  const unknown: Truth = { kind: 'undeterminable', causes: [], alsoOk: [], unrelated: [] };
  assert.equal(score({ verdict: 'undetermined', causes: [] }, unknown, estate).causeAccuracy, true);
  const blamed = score({ verdict: 'undetermined', causes: [{ host: 'web tier', confidence: 'high' }] }, unknown, estate);
  assert.deepEqual([blamed.causeAccuracy, blamed.falseBlame], [false, ['web-01', 'web-02']]);
});

test('an answer with no verdict field is read from whether it gives causes', () => {
  assert.equal(score({ causes: [{ host: 'nas-01' }] }, fault([['nas-01']]), estate).verdict, true);
  assert.equal(score({ causes: [] }, fault([['nas-01']]), estate).verdict, false);
});

test('unrelated alerts must be set aside and not blamed', () => {
  const truth = fault([['app-03']], { unrelated: ['web-02'] });
  const base = { verdict: 'cause_found', causes: [{ host: 'app-03', confidence: 'high' }] };
  assert.equal(score({ ...base, unrelated_alerts: ['web-02: Disk space is low on /'] }, truth, estate).unrelated, 'pass');
  assert.equal(score(base, truth, estate).unrelated, 'fail');
  const blamed = { ...base, causes: [...base.causes, { host: 'web-02', confidence: 'medium' }], unrelated_alerts: ['web-02: Disk'] };
  assert.equal(score(blamed, truth, estate).unrelated, 'fail');
  assert.equal(score(base, fault([['app-03']]), estate).unrelated, 'n/a');
});
