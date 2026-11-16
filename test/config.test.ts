import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from '../src/config.ts';

const SECRET = 'a-secret-of-sixteen-chars';

test('defaults apply when only the secret is set', () => {
  const c = loadConfig({ CAUSEWISE_WEBHOOK_SECRET: SECRET });
  assert.deepEqual(
    { host: c.host, port: c.port, settle: c.settleSeconds, quiet: c.quietSeconds },
    { host: '127.0.0.1', port: 8787, settle: 90, quiet: 600 },
  );
});

test('a missing or short secret is rejected by name', () => {
  assert.throws(() => loadConfig({}), /CAUSEWISE_WEBHOOK_SECRET/);
  assert.throws(() => loadConfig({ CAUSEWISE_WEBHOOK_SECRET: 'short' }), ConfigError);
});

test('an invalid number is rejected with the variable name and the value', () => {
  assert.throws(
    () => loadConfig({ CAUSEWISE_WEBHOOK_SECRET: SECRET, CAUSEWISE_PORT: 'eighty' }),
    /CAUSEWISE_PORT.*"eighty"/,
  );
  assert.throws(
    () => loadConfig({ CAUSEWISE_WEBHOOK_SECRET: SECRET, CAUSEWISE_SETTLE_SECONDS: '-1' }),
    /CAUSEWISE_SETTLE_SECONDS/,
  );
});
