#!/usr/bin/env node
// Lab check for the investigation tools and the read-only guarantee, on
// Zabbix 7.0 and 8.0. Needs the lab running with data replayed into it.
// Not part of CI.
//
//   npm run e2e:tools [7.0|8.0]
//
// 1. Creates the dedicated read-only role, user and API token.
// 2. Runs every tool with that token.
// 3. Confirms that Zabbix itself refuses writes made with that token, so the
//    client's allow-list is the second line of defence, not the only one.
import { execFileSync } from 'node:child_process';
import { LABS } from '../sim/zabbix.mjs';
import { ZabbixClient, READ_METHODS } from '../src/zabbix/client.ts';
import { Investigation, TOOL_SPECS } from '../src/tools.ts';

const WRITES = [
  ['history.push', [{ host: 'web-01', key: 'cpu.util.pct', value: 1 }]],
  ['event.acknowledge', { eventids: ['1'], action: 4, message: 'x' }],
  ['host.update', { hostid: '1', description: 'x' }],
  ['host.delete', ['1']],
  ['user.get', {}],
  ['script.execute', { scriptid: '1', hostid: '1' }],
];

async function check(lab) {
  const failures = [];
  const url = LABS[lab].api;
  const token = execFileSync('node', ['tools/lab-readonly-token.mjs', lab]).toString().trim().split('\n').at(-1);
  const inv = new Investigation(new ZabbixClient({ url, token, minIntervalMs: 50 }));

  for (const spec of TOOL_SPECS) {
    const args = spec.name === 'history' ? { host: 'db-01', key: 'db.conn.count' } : 'required' in spec.input_schema ? { host: 'db-01' } : {};
    try {
      const text = await inv.run(spec.name, args);
      console.log(`[${lab}] ${spec.name.padEnd(12)} ok   ${text.split('\n')[0]}`);
      if (spec.name === 'hosts' && !text.includes('tags: role=db')) failures.push('hosts: tags missing');
      if (spec.name === 'items' && !text.includes('db.conn.count')) failures.push('items: expected metric missing');
      if (spec.name === 'triggers' && !text.includes('when ')) failures.push('triggers: no conditions shown');
    } catch (e) {
      failures.push(`${spec.name}: ${e.message}`);
    }
  }

  for (const [method, params] of WRITES) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json-rpc', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    });
    const body = await res.json();
    const refused = /No permissions to call/.test(body.error?.data ?? '');
    console.log(`[${lab}] ${method.padEnd(18)} ${refused ? 'refused by Zabbix' : `NOT REFUSED: ${JSON.stringify(body).slice(0, 120)}`}`);
    if (!refused) failures.push(`${method} was not refused by Zabbix for the read-only token`);
  }
  console.log(`[${lab}] role allow-list: ${READ_METHODS.join(', ')}`);
  return failures;
}

let failed = false;
for (const lab of process.argv[2] ? [process.argv[2]] : ['7.0', '8.0']) {
  const failures = await check(lab);
  console.log(failures.length ? `[${lab}] FAIL\n  - ${failures.join('\n  - ')}` : `[${lab}] PASS`);
  failed ||= failures.length > 0;
}
process.exit(failed ? 1 : 0);
