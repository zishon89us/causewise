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

export function loadConfig(env: Env): Config {
  const webhookSecret = env.CAUSEWISE_WEBHOOK_SECRET ?? '';
  if (webhookSecret.length < 16) {
    throw new ConfigError('CAUSEWISE_WEBHOOK_SECRET is required and must be at least 16 characters');
  }
  return {
    host: env.CAUSEWISE_HOST || '127.0.0.1',
    port: integer(env, 'CAUSEWISE_PORT', 8787, 1, 65535),
    dbPath: env.CAUSEWISE_DB || './data/causewise.db',
    webhookSecret,
    settleSeconds: integer(env, 'CAUSEWISE_SETTLE_SECONDS', 90, 0, 3600),
    quietSeconds: integer(env, 'CAUSEWISE_QUIET_SECONDS', 600, 0, 86400),
  };
}
