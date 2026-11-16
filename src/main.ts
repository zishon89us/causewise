// Entry point: configuration, store, incident former, HTTP receiver.
import { ConfigError, loadConfig, type Config } from './config.ts';
import { Store } from './store.ts';
import { IncidentFormer } from './incidents.ts';
import { createReceiver } from './server.ts';
import { ZabbixClient } from './zabbix/client.ts';
import { ClaudeClient } from './llm-claude.ts';
import { loadPrompt } from './prompt.ts';
import { investigateIncident, type InvestigatorDeps } from './run-investigation.ts';

const log = (entry: Record<string, unknown>): void => {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...entry }));
};
const now = (): number => Math.floor(Date.now() / 1000);

let config: Config;
try {
  config = loadConfig(process.env);
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(`causewise: configuration error: ${e.message}`);
    process.exit(1);
  }
  throw e;
}

const store = new Store(config.dbPath);

let investigator: InvestigatorDeps | null = null;
if (config.investigator) {
  const c = config.investigator;
  investigator = {
    store,
    zabbix: new ZabbixClient({ url: c.zabbixUrl, token: c.zabbixToken }),
    llm: new ClaudeClient({ model: c.model, effort: c.effort }),
    prompt: loadPrompt('investigator'),
    config: c,
    now,
    log,
  };
}
// Investigations run one at a time, in the order incidents became ready.
let queue: Promise<unknown> = Promise.resolve();

const former = new IncidentFormer(store, {
  settleSeconds: config.settleSeconds,
  quietSeconds: config.quietSeconds,
  onReady: (incident) => {
    log({ event: 'incident_ready', incident: incident.id, alerts: store.alerts(incident.id).length });
    const deps = investigator;
    if (deps) queue = queue.then(() => investigateIncident(deps, incident.id));
  },
  onClosed: (incident) => log({ event: 'incident_closed', incident: incident.id }),
});

const server = createReceiver({ former, webhookSecret: config.webhookSecret, now, log });
const timer = setInterval(() => {
  try {
    former.tick(now());
  } catch (e) {
    log({ event: 'error', message: (e as Error).message });
  }
}, 1000);

server.listen(config.port, config.host, () => {
  log({
    event: 'listening', host: config.host, port: config.port, settle_seconds: config.settleSeconds,
    investigator: config.investigator ? { model: config.investigator.model, prompt: investigator?.prompt.version } : 'not configured',
  });
});

const shutdown = (): void => {
  clearInterval(timer);
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
