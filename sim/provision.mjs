// Create the simulated estate in a lab Zabbix. Idempotent: deletes and
// recreates the "causewise-lab" host group's hosts.
import { ZabbixApi, LABS } from './zabbix.mjs';
import { hosts } from './topology.mjs';

const lab = process.argv[2];
if (!LABS[lab]) throw new Error('usage: node sim/provision.mjs <7.0|8.0>');
const api = await new ZabbixApi(LABS[lab].api).login();

const GROUP = 'causewise-lab';
let [group] = await api.call('hostgroup.get', { filter: { name: [GROUP] } });
if (group) {
  const old = await api.call('host.get', { groupids: [group.groupid], output: ['hostid'] });
  if (old.length) await api.call('host.delete', old.map((h) => h.hostid));
} else {
  group = { groupid: (await api.call('hostgroup.create', { name: GROUP })).groupids[0] };
}

for (const h of hosts) {
  const { hostids } = await api.call('host.create', {
    host: h.name,
    groups: [{ groupid: group.groupid }],
    tags: Object.entries(h.tags).map(([tag, value]) => ({ tag, value })),
  });
  await api.call(
    'item.create',
    h.items.map((i) => ({
      hostid: hostids[0],
      name: i.key,
      key_: i.key,
      type: 2, // trapper
      value_type: 0, // float
      delay: '0',
      // Zabbix 8.0 only accepts trapper values from localhost by default; the
      // lab sender arrives from the Docker bridge network.
      trapper_hosts: '127.0.0.1,172.16.0.0/12',
    })),
  );
  if (h.triggers.length) {
    await api.call(
      'trigger.create',
      h.triggers.map((t) => ({ description: t.name, expression: t.expression, priority: t.severity })),
    );
  }
}
const nItems = hosts.reduce((n, h) => n + h.items.length, 0);
const nTrig = hosts.reduce((n, h) => n + h.triggers.length, 0);
console.log(`lab ${lab}: ${hosts.length} hosts, ${nItems} items, ${nTrig} triggers`);
