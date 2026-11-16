#!/usr/bin/env node
// Read-only investigation queries against Zabbix, "as of" a moment in time.
// Nothing after --at is ever returned, so a past incident can be investigated
// as if it were happening now.
//
//   node tools/zq.mjs --lab 7.0 --at <epoch> problems
//   node tools/zq.mjs --lab 7.0 --at <epoch> hosts
//   node tools/zq.mjs --lab 7.0 --at <epoch> items <host>
//   node tools/zq.mjs --lab 7.0 --at <epoch> history <host> <key> [minutes=30]
//   node tools/zq.mjs --lab 7.0 --at <epoch> events [minutes=30]
import { ZabbixApi, LABS } from '../sim/zabbix.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const lab = opt('lab') ?? '7.0';
const at = Number(opt('at'));
const [cmd, ...rest] = args;
if (!LABS[lab] || !at || !cmd) {
  console.error('usage: zq.mjs --lab <7.0|8.0> --at <epoch> <problems|hosts|items|history|events> ...');
  process.exit(2);
}
const MAX_LOOKBACK = 120 * 60;
const SEV = ['not classified', 'info', 'warning', 'average', 'high', 'disaster'];
const iso = (s) => new Date(s * 1000).toISOString().slice(11, 19);
const rel = (s) => `${s - at >= 0 ? '+' : ''}${Math.round((s - at) / 60)}m`;

const api = await new ZabbixApi(LABS[lab].api).login();

async function triggerEvents(from) {
  const evs = await api.call('event.get', {
    source: 0, object: 0, time_from: from, time_till: at,
    output: ['eventid', 'clock', 'name', 'severity', 'value', 'r_eventid', 'cause_eventid'],
    selectHosts: ['host'], sortfield: ['clock', 'eventid'],
  });
  // Events whose host has since been deleted carry no host; skip them.
  return evs.filter((e) => e.hosts.length).map((e) => ({ ...e, clock: Number(e.clock), host: e.hosts[0].host }));
}

if (cmd === 'problems') {
  // Problems that started before --at and had not recovered by --at.
  const evs = await triggerEvents(at - MAX_LOOKBACK);
  const recoveredAt = new Map(evs.filter((e) => e.value === '0').map((e) => [e.eventid, e.clock]));
  const open = evs.filter((e) => e.value === '1' && !(recoveredAt.get(e.r_eventid) <= at));
  console.log(`Open problems as of ${iso(at)} UTC (${open.length}):`);
  for (const e of open) {
    console.log(`${iso(e.clock)} (${rel(e.clock)})  ${SEV[e.severity].padEnd(8)} ${e.host.padEnd(12)} ${e.name}`);
  }
} else if (cmd === 'events') {
  const minutes = Math.min(Number(rest[0] ?? 30), MAX_LOOKBACK / 60);
  const evs = await triggerEvents(at - minutes * 60);
  console.log(`Trigger events in the ${minutes} minutes before ${iso(at)} UTC:`);
  for (const e of evs) {
    console.log(`${iso(e.clock)} (${rel(e.clock)})  ${e.value === '1' ? 'PROBLEM ' : 'RESOLVED'} ${SEV[e.severity].padEnd(8)} ${e.host.padEnd(12)} ${e.name}`);
  }
} else if (cmd === 'hosts') {
  const hs = await api.call('host.get', { output: ['host'], selectTags: ['tag', 'value'], sortfield: 'host' });
  for (const h of hs) console.log(`${h.host.padEnd(12)} ${h.tags.map((t) => `${t.tag}=${t.value}`).join(' ')}`);
} else if (cmd === 'items') {
  const items = await api.call('item.get', { host: rest[0], output: ['itemid', 'key_'], sortfield: 'key_' });
  if (!items.length) console.log(`no such host or no items: ${rest[0]}`);
  for (const it of items) {
    const [last] = await api.call('history.get', { itemids: [it.itemid], history: 0, time_till: at, sortfield: 'clock', sortorder: 'DESC', limit: 1 });
    console.log(`${it.key_.padEnd(26)} ${last ? `${last.value}  (${rel(Number(last.clock))})` : 'no data'}`);
  }
} else if (cmd === 'history') {
  const [host, key] = rest;
  const minutes = Math.min(Number(rest[2] ?? 30), MAX_LOOKBACK / 60);
  const [it] = await api.call('item.get', { host, filter: { key_: key }, output: ['itemid'] });
  if (!it) { console.log(`no such item: ${host} ${key}`); process.exit(0); }
  const hist = await api.call('history.get', { itemids: [it.itemid], history: 0, time_from: at - minutes * 60, time_till: at, sortfield: 'clock' });
  console.log(`${host} ${key}, last ${minutes} minutes before ${iso(at)} UTC (${hist.length} samples):`);
  for (const p of hist) console.log(`${iso(Number(p.clock))} (${rel(Number(p.clock))})  ${p.value}`);
} else {
  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}
