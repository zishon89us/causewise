// Entry point: configuration, store, incident former, HTTP receiver.
import { ConfigError, loadConfig, type Config } from './config.ts';
import { Store } from './store.ts';
import { IncidentFormer } from './incidents.ts';
import { createReceiver } from './server.ts';

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
const former = new IncidentFormer(store, {
  settleSeconds: config.settleSeconds,
  quietSeconds: config.quietSeconds,
  // The investigator (M3) hooks in here.
  onReady: (incident) =>
    log({ event: 'incident_ready', incident: incident.id, alerts: store.alerts(incident.id).length }),
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
  log({ event: 'listening', host: config.host, port: config.port, settle_seconds: config.settleSeconds });
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
