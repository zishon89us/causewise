// Configuration comes from environment variables only. A bad value stops the
// process at start-up with a message naming the variable (US-1).

export interface Config {
  host: string;
  port: number;
  dbPath: string;
  webhookSecret: string;
  /** Seconds to wait after the first alert before an incident is ready. */
  settleSeconds: number;
  /** Seconds with every alert recovered before an incident is closed. */
  quietSeconds: number;
  /** Null when not configured: alerts are received and incidents formed, but nothing is investigated. */
  investigator: InvestigatorConfig | null;
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export interface InvestigatorConfig {
  /** Full URL of Zabbix's api_jsonrpc.php. */
  zabbixUrl: string;
  /** API token of the dedicated read-only Zabbix user (docs/install.md). */
  zabbixToken: string;
  model: string;
  effort: Effort;
  /** Tool calls allowed per incident. */
  maxQueries: number;
}

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;

function integer(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name} must be a whole number between ${min} and ${max}, got "${raw}"`);
  }
  return n;
}

function investigator(env: Env): InvestigatorConfig | null {
  const zabbixUrl = env.CAUSEWISE_ZABBIX_URL ?? '';
  const zabbixToken = env.CAUSEWISE_ZABBIX_TOKEN ?? '';
  if (zabbixUrl === '' && zabbixToken === '') return null;
  if (zabbixUrl === '' || zabbixToken === '') {
    throw new ConfigError('CAUSEWISE_ZABBIX_URL and CAUSEWISE_ZABBIX_TOKEN must be set together');
  }
  if (!URL.canParse(zabbixUrl) || !/^https?:$/.test(new URL(zabbixUrl).protocol)) {
    throw new ConfigError(`CAUSEWISE_ZABBIX_URL must be an http or https URL, got "${zabbixUrl}"`);
  }
  // The Anthropic SDK reads the key itself; only its presence is checked here.
  if (!env.ANTHROPIC_API_KEY) {
    throw new ConfigError('ANTHROPIC_API_KEY is required when CAUSEWISE_ZABBIX_URL is set');
  }
  const effort = env.CAUSEWISE_EFFORT || 'medium';
  if (!EFFORTS.includes(effort)) {
    throw new ConfigError(`CAUSEWISE_EFFORT must be one of ${EFFORTS.join(', ')}, got "${effort}"`);
  }
  return {
    zabbixUrl,
    zabbixToken,
    model: env.CAUSEWISE_MODEL || 'claude-opus-5-5',
    effort: effort as Effort,
    maxQueries: integer(env, 'CAUSEWISE_MAX_QUERIES', 30, 5, 100),
  };
}

export function loadConfig(env: Env): Config {
  const webhookSecret = env.CAUSEWISE_WEBHOOK_SECRET ?? '';
  if (webhookSecret.length < 16) {
    throw new ConfigError('CAUSEWISE_WEBHOOK_SECRET is required and must be at least 16 characters');
  }
  return {
    investigator: investigator(env),
    host: env.CAUSEWISE_HOST || '127.0.0.1',
    port: integer(env, 'CAUSEWISE_PORT', 8787, 1, 65535),
    dbPath: env.CAUSEWISE_DB || './data/causewise.db',
    webhookSecret,
    settleSeconds: integer(env, 'CAUSEWISE_SETTLE_SECONDS', 90, 0, 3600),
    quietSeconds: integer(env, 'CAUSEWISE_QUIET_SECONDS', 600, 0, 86400),
  };
}
