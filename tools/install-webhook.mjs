#!/usr/bin/env node
// Set up the causewise webhook on a lab Zabbix through the API: the media
// type, a media entry on the Admin user, and an action that sends every
// trigger problem and recovery to it. Idempotent.
//
//   node tools/install-webhook.mjs <7.0|8.0> <receiver-url> <secret>
//
// On a real installation do the same three steps in the Zabbix frontend;
// see docs/install.md.
import fs from 'node:fs';
import { ZabbixApi, LABS } from '../sim/zabbix.mjs';

const [lab, url, secret] = process.argv.slice(2);
if (!LABS[lab] || !url || !secret) {
  console.error('usage: node tools/install-webhook.mjs <7.0|8.0> <receiver-url> <secret>');
  process.exit(2);
}
const api = await new ZabbixApi(LABS[lab].api).login();
const NAME = 'causewise';

const parameters = Object.entries({
  url,
  secret,
  event_id: '{EVENT.ID}',
  event_value: '{EVENT.VALUE}',
  event_update_status: '{EVENT.UPDATE.STATUS}',
  event_name: '{EVENT.NAME}',
  severity: '{EVENT.NSEVERITY}',
  host: '{HOST.HOST}',
  trigger_id: '{TRIGGER.ID}',
  tags: '{EVENT.TAGSJSON}',
}).map(([name, value]) => ({ name, value }));

const mediaType = {
  name: NAME,
  type: 4, // webhook
  status: 0, // enabled (Zabbix 8.0 creates media types disabled unless told otherwise)
  script: fs.readFileSync(new URL('../zabbix/webhook.js', import.meta.url), 'utf8'),
  timeout: '10s',
  parameters,
  // The webhook ignores message text, but Zabbix sends nothing for an event
  // type that has no template.
  message_templates: [0, 1].map((recovery) => ({ eventsource: 0, recovery, subject: '{EVENT.NAME}', message: '{EVENT.ID}' })),
  description: 'Sends trigger problems and recoveries to causewise.',
};

const [existing] = await api.call('mediatype.get', { filter: { name: NAME }, output: ['mediatypeid'] });
const mediatypeid = existing
  ? (await api.call('mediatype.update', { mediatypeid: existing.mediatypeid, ...mediaType })).mediatypeids[0]
  : (await api.call('mediatype.create', mediaType)).mediatypeids[0];

const [admin] = await api.call('user.get', { filter: { username: 'Admin' }, output: ['userid'], selectMedias: 'extend' });
const others = admin.medias
  .filter((m) => m.mediatypeid !== mediatypeid)
  .map(({ mediatypeid: id, sendto, active, severity, period }) => ({ mediatypeid: id, sendto, active, severity, period }));
await api.call('user.update', {
  userid: admin.userid,
  medias: [...others, { mediatypeid, sendto: ['causewise'], active: 0, severity: 63, period: '1-7,00:00-24:00' }],
});

const operation = { operationtype: 0, opmessage: { default_msg: 1, mediatypeid }, opmessage_usr: [{ userid: admin.userid }] };
const action = {
  name: NAME,
  eventsource: 0,
  status: 0,
  esc_period: '1h',
  operations: [{ ...operation, esc_step_from: 1, esc_step_to: 1 }],
  recovery_operations: [operation],
};
const [oldAction] = await api.call('action.get', { filter: { name: NAME }, output: ['actionid'] });
if (oldAction) await api.call('action.delete', [oldAction.actionid]);
await api.call('action.create', action);

// Keep an importable copy of the media type, without the lab's URL and secret.
const yaml = await api.call('configuration.export', { format: 'yaml', options: { mediaTypes: [mediatypeid] } });
const scrubbed = yaml.split(url).join('http://causewise.example:8787/v1/alerts').split(secret).join('CHANGE-ME');
fs.writeFileSync(new URL(`../zabbix/media-type-${lab}.yaml`, import.meta.url), scrubbed);
console.log(`lab ${lab}: media type ${mediatypeid}, user media and action installed; wrote zabbix/media-type-${lab}.yaml`);
