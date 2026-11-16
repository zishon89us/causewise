import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUBMIT_DIAGNOSIS, validateDiagnosis } from '../src/diagnosis.ts';

const good = {
  verdict: 'cause_found',
  causes: [{ host: 'nas-01', what: 'Storage latency rose to 120 ms.', confidence: 'high' }],
  unrelated_alerts: ['web-02: Disk space is low on /'],
  ruled_out: ['db-01 CPU and memory'],
  evidence: [{ claim: 'nas-01 latency went from 4 ms to 120 ms at 03:02', query: 4 }],
  next_step: 'Check the storage array for a rebuild.',
};

test('a complete diagnosis is accepted', () => {
  assert.deepEqual(validateDiagnosis(good, 5), []);
});

test('evidence may only cite a query that ran', () => {
  assert.match(validateDiagnosis(good, 3).join(), /evidence\[0\]\.query .*1 to 3/);
  assert.match(validateDiagnosis({ ...good, evidence: [{ claim: 'x', query: 0 }] }, 5).join(), /evidence\[0\]\.query/);
});

test('the verdict must agree with the causes', () => {
  assert.match(validateDiagnosis({ ...good, causes: [] }, 5).join(), /cause_found needs at least one cause/);
  assert.match(validateDiagnosis({ ...good, verdict: 'benign' }, 5).join(), /benign must have no causes/);
  assert.match(validateDiagnosis({ ...good, verdict: 'undetermined', causes: [], ruled_out: [] }, 5).join(), /must list what was ruled out/);
  assert.deepEqual(validateDiagnosis({ ...good, verdict: 'undetermined', causes: [] }, 5), []);
  assert.deepEqual(validateDiagnosis({ ...good, verdict: 'benign', causes: [] }, 5), []);
});

test('the model cannot choose the incomplete verdict', () => {
  assert.match(validateDiagnosis({ ...good, verdict: 'incomplete', causes: [] }, 5).join(), /verdict must be/);
});

test('malformed input is reported field by field, not thrown', () => {
  assert.deepEqual(validateDiagnosis(null, 5), ['the diagnosis must be an object']);
  const errors = validateDiagnosis({ verdict: 'cause_found', causes: [{ host: '', confidence: 'certain' }], evidence: 'none' }, 5).join('\n');
  for (const part of ['causes[0].host', 'causes[0].what', 'causes[0].confidence', 'unrelated_alerts must be an array', 'evidence must be an array', 'next_step']) {
    assert.ok(errors.includes(part), `missing: ${part}`);
  }
  assert.match(validateDiagnosis({ ...good, next_step: 'x'.repeat(700) }, 5).join(), /next_step is longer/);
});

test('the submit tool is strict and closed, as strict tool use requires', () => {
  const closed = (schema: any): void => {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
      Object.values(schema.properties).forEach(closed);
    }
    if (schema.type === 'array') closed(schema.items);
  };
  assert.equal(SUBMIT_DIAGNOSIS.strict, true);
  closed(SUBMIT_DIAGNOSIS.input_schema);
});
