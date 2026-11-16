// The only code that talks to the Zabbix API. Read-only by construction:
// a call to any method outside READ_METHODS is refused before a request is
// made (AGENTS.md hard limit, ADR 0003).

/** Keep in step with API_METHODS in tools/lab-readonly-token.mjs and docs/install.md. */
export const READ_METHODS = [
  'event.get',
  'history.get',
  'host.get',
  'item.get',
  'maintenance.get',
  'trigger.get',
] as const;

export type ReadMethod = (typeof READ_METHODS)[number];

export class MethodNotAllowedError extends Error {
  constructor(method: string) {
    super(`refused to call Zabbix API method "${method}": it is not on the read-only allow-list`);
  }
}

export class ZabbixApiError extends Error {}

export interface ClientOptions {
  /** Full URL of api_jsonrpc.php. */
  url: string;
  /** API token of a user with a read-only role. */
  token: string;
  /** Minimum gap between requests, to protect Zabbix. Default 500 ms (2 per second). */
  minIntervalMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class ZabbixClient {
  private readonly opts: Required<ClientOptions>;
  private id = 0;
  private nextSlot = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: ClientOptions) {
    this.opts = {
      minIntervalMs: 500,
      timeoutMs: 10_000,
      fetch: globalThis.fetch,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: Date.now,
      ...opts,
    };
  }

  call<T>(method: ReadMethod, params: Record<string, unknown> = {}): Promise<T> {
    // Checked at run time as well as by the type, because tool arguments can
    // originate from a model.
    if (!(READ_METHODS as readonly string[]).includes(method)) {
      return Promise.reject(new MethodNotAllowedError(method));
    }
    // Requests run one at a time, spaced by minIntervalMs.
    const run = this.queue.then(() => this.send<T>(method, params));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async send<T>(method: ReadMethod, params: Record<string, unknown>): Promise<T> {
    const wait = this.nextSlot - this.opts.now();
    if (wait > 0) await this.opts.sleep(wait);
    this.nextSlot = this.opts.now() + this.opts.minIntervalMs;

    let res: Response;
    try {
      res = await this.opts.fetch(this.opts.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json-rpc', Authorization: `Bearer ${this.opts.token}` },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: ++this.id }),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (e) {
      throw new ZabbixApiError(`${method}: request failed: ${(e as Error).message}`);
    }
    if (!res.ok) throw new ZabbixApiError(`${method}: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { message: string; data?: string } };
    if (body.error) throw new ZabbixApiError(`${method}: ${body.error.message} ${body.error.data ?? ''}`.trim());
    return body.result as T;
  }
}
