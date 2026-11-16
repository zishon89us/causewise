#!/usr/bin/env node
// Create (or recreate) a read-only Zabbix user for causewise in a lab and
// print an API token for it. This is what docs/install.md asks an operator
// to do by hand: a dedicated role whose API access is an allow-list of read
// methods, and a user with that role in a user group that has read-only
// permission on the monitored host groups.
//
// The dedicated role matters. Tested in the lab: on 7.0 a user with the
// built-in "User role" and read-only host permissions can still call
// history.push; on 8.0 the built-in role cannot call the API at all.
//
//   node tools/lab-readonly-token.mjs <7.0|8.0>
import { randomBytes } from 'node:crypto';
import { ZabbixApi, LABS } from '../sim/zabbix.mjs';

const lab = process.argv[2];
if (!LABS[lab]) {
  console.error('usage: node tools/lab-readonly-token.mjs <7.0|8.0>');
  process.exit(2);
}
const api = await new ZabbixApi(LABS[lab].api).login();
const NAME = 'causewise';

const [hostGroup] = await api.call('hostgroup.get', { filter: { name: ['causewise-lab'] }, output: ['groupid'] });
if (!hostGroup) throw new Error('run sim/provision.mjs first');

const groupSpec = { name: `${NAME}-readers`, hostgroup_rights: [{ id: hostGroup.groupid, permission: 2 }] }; // 2 = read
const [oldGroup] = await api.call('usergroup.get', { filter: { name: [groupSpec.name] }, output: ['usrgrpid'] });
const usrgrpid = oldGroup
  ? (await api.call('usergroup.update', { usrgrpid: oldGroup.usrgrpid, ...groupSpec })).usrgrpids[0]
  : (await api.call('usergroup.create', groupSpec)).usrgrpids[0];

// Keep in step with READ_METHODS in src/zabbix/client.ts.
const API_METHODS = ['event.get', 'history.get', 'host.get', 'item.get', 'maintenance.get', 'trigger.get'];
const roleSpec = {
  name: `${NAME} read-only`,
  type: 1, // User
  rules: { 'api.access': 1, 'api.mode': 1, api: API_METHODS, 'actions.default_access': 0, 'ui.default_access': 0 },
};
const [oldRole] = await api.call('role.get', { filter: { name: [roleSpec.name] }, output: ['roleid'] });
const role = {
  roleid: oldRole
    ? (await api.call('role.update', { roleid: oldRole.roleid, ...roleSpec })).roleids[0]
    : (await api.call('role.create', roleSpec)).roleids[0],
};
const [oldUser] = await api.call('user.get', { filter: { username: [NAME] }, output: ['userid'] });
if (oldUser) await api.call('user.update', { userid: oldUser.userid, roleid: role.roleid, usrgrps: [{ usrgrpid }] });
const userid = oldUser
  ? oldUser.userid
  : (
      await api.call('user.create', {
        username: NAME,
        passwd: randomBytes(24).toString('base64url') + 'aA1!',
        roleid: role.roleid,
        usrgrps: [{ usrgrpid }],
      })
    ).userids[0];

const old = await api.call('token.get', { userids: [userid], output: ['tokenid'] });
if (old.length) await api.call('token.delete', old.map((t) => t.tokenid));
const { tokenids } = await api.call('token.create', { name: NAME, userid });
const [{ token }] = await api.call('token.generate', tokenids);
console.log(token);
