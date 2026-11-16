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

const ZBX = { CAUSEWISE_WEBHOOK_SECRET: SECRET, CAUSEWISE_ZABBIX_URL: 'http://zabbix/api_jsonrpc.php', CAUSEWISE_ZABBIX_TOKEN: 't', ANTHROPIC_API_KEY: 'k' };

test('without Zabbix settings the investigator is off', () => {
  assert.equal(loadConfig({ CAUSEWISE_WEBHOOK_SECRET: SECRET }).investigator, null);
});

test('with Zabbix settings and a key the investigator is on, with defaults', () => {
  assert.deepEqual(loadConfig(ZBX).investigator, {
    zabbixUrl: 'http://zabbix/api_jsonrpc.php', zabbixToken: 't', model: 'claude-opus-5-5', effort: 'medium', maxQueries: 30,
  });
  const custom = loadConfig({ ...ZBX, CAUSEWISE_MODEL: 'claude-sonnet-5-5', CAUSEWISE_EFFORT: 'low', CAUSEWISE_MAX_QUERIES: '12' }).investigator;
  assert.deepEqual([custom?.model, custom?.effort, custom?.maxQueries], ['claude-sonnet-5-5', 'low', 12]);
});

test('incomplete or invalid investigator settings are rejected by name', () => {
  assert.throws(() => loadConfig({ ...ZBX, CAUSEWISE_ZABBIX_TOKEN: '' }), /must be set together/);
  assert.throws(() => loadConfig({ ...ZBX, ANTHROPIC_API_KEY: undefined }), /ANTHROPIC_API_KEY is required/);
  assert.throws(() => loadConfig({ ...ZBX, CAUSEWISE_ZABBIX_URL: 'zabbix.local' }), /CAUSEWISE_ZABBIX_URL must be an http or https URL/);
  assert.throws(() => loadConfig({ ...ZBX, CAUSEWISE_EFFORT: 'extreme' }), /CAUSEWISE_EFFORT/);
  assert.throws(() => loadConfig({ ...ZBX, CAUSEWISE_MAX_QUERIES: '1000' }), /CAUSEWISE_MAX_QUERIES/);
});
