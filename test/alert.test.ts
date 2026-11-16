import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAlert } from '../src/alert.ts';

const base = {
  event_id: '1042',
  event_value: '1',
  event_update_status: '0',
  event_name: 'Slow HTTP response',
  severity: '3',
  host: 'web-01',
  trigger_id: '77',
  tags: '[{"tag":"role","value":"web"}]',
};

test('a problem payload parses', () => {
  const r = parseAlert(base);
  assert.ok(r.ok && 'alert' in r);
  assert.deepEqual(r.alert, {
    eventId: '1042', kind: 'problem', name: 'Slow HTTP response', severity: 3,
    host: 'web-01', triggerId: '77', tags: [{ tag: 'role', value: 'web' }],
  });
});

test('event_value 0 is a recovery', () => {
  const r = parseAlert({ ...base, event_value: '0' });
  assert.ok(r.ok && 'alert' in r && r.alert.kind === 'recovery');
});

test('a problem update is ignored, not stored', () => {
  const r = parseAlert({ ...base, event_update_status: '1' });
  assert.ok(r.ok && 'ignored' in r);
});

test('missing tags mean no tags', () => {
  const r = parseAlert({ ...base, tags: undefined });
  assert.ok(r.ok && 'alert' in r && r.alert.tags.length === 0);
});

for (const [name, patch, pattern] of [
  ['non-numeric event id', { event_id: '12; DROP' }, /event_id/],
  ['unknown event value', { event_value: '2' }, /event_value/],
  ['severity out of range', { severity: '9' }, /severity/],
  ['empty host', { host: '' }, /host/],
  ['oversized name', { event_name: 'x'.repeat(3000) }, /event_name/],
  ['broken tags JSON', { tags: '[{' }, /tags/],
  ['tags not an array', { tags: '{"a":1}' }, /tags/],
] as const) {
  test(`rejects ${name}`, () => {
    const r = parseAlert({ ...base, ...patch });
    assert.ok(!r.ok);
    assert.match(r.error, pattern);
  });
}

test('rejects a body that is not an object', () => {
  assert.ok(!parseAlert([base]).ok);
  assert.ok(!parseAlert('text').ok);
  assert.ok(!parseAlert(null).ok);
});
