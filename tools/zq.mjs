#!/usr/bin/env node
// Command-line front end to the investigator's tools (src/tools.ts), for
// people and for blind evaluation runs. Read-only. With --at, nothing after
// that moment is returned, so a replayed incident can be investigated as if
// it were happening now.
//
//   node tools/zq.mjs [--lab 7.0|8.0] [--at <epoch>] [--notags] <tool> [args]
//
//   problems | events [minutes] | hosts | items <host>
//   history <host> <key> [minutes] | triggers <host> | maintenance
//
// Authentication: CAUSEWISE_ZABBIX_URL and CAUSEWISE_ZABBIX_TOKEN if set
// (use a token for a read-only role). Otherwise it logs in to the chosen lab
// with the lab's default Admin account.
import { ZabbixApi, LABS } from '../sim/zabbix.mjs';
import { ZabbixClient } from '../src/zabbix/client.ts';
import { Investigation, TOOL_SPECS } from '../src/tools.ts';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args.splice(i, 1).length > 0;
};
const lab = opt('lab') ?? '7.0';
const at = opt('at');
const hideTags = flag('notags');
const [tool, ...rest] = args;

if (!tool || !TOOL_SPECS.some((t) => t.name === tool) || (at !== undefined && !Number(at))) {
  console.error('usage: zq.mjs [--lab 7.0|8.0] [--at <epoch>] [--notags] <tool> [args]');
  console.error(`tools: ${TOOL_SPECS.map((t) => t.name).join(', ')}`);
  process.exit(2);
}

let url = process.env.CAUSEWISE_ZABBIX_URL;
let token = process.env.CAUSEWISE_ZABBIX_TOKEN;
if (!url || !token) {
  if (!LABS[lab]) throw new Error(`unknown lab: ${lab}`);
  url = LABS[lab].api;
  token = (await new ZabbixApi(url).login()).auth;
}

const num = (v) => (v === undefined ? undefined : Number(v));
const toolArgs = {
  events: () => ({ minutes: num(rest[0]) }),
  items: () => ({ host: rest[0] }),
  triggers: () => ({ host: rest[0] }),
  history: () => ({ host: rest[0], key: rest[1], minutes: num(rest[2]) }),
}[tool]?.() ?? {};
for (const k of Object.keys(toolArgs)) if (toolArgs[k] === undefined) delete toolArgs[k];

const investigation = new Investigation(new ZabbixClient({ url, token, minIntervalMs: 50 }), {
  asOf: at === undefined ? undefined : Number(at),
  hideTags,
});
try {
  console.log(await investigation.run(tool, toolArgs));
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
