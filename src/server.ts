// HTTP receiver for the Zabbix webhook. It authenticates, validates, hands
// the alert to the incident former and answers at once; nothing slow happens
// on the request path.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { parseAlert } from './alert.ts';
import type { IncidentFormer } from './incidents.ts';

const MAX_BODY_BYTES = 64 * 1024;

export interface ServerDeps {
  former: IncidentFormer;
  webhookSecret: string;
  /** Epoch seconds. */
  now: () => number;
  log: (entry: Record<string, unknown>) => void;
}

function secretMatches(given: string | undefined, expected: string): boolean {
  // Hash both sides so the comparison is constant-time whatever their lengths.
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(given ?? ''), digest(expected));
}

function send(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.resume(); // drain without keeping it
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createReceiver(deps: ServerDeps): Server {
  return createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/healthz') return send(res, 200, { status: 'ok' });
      if (req.url !== '/v1/alerts') return send(res, 404, { error: 'not found' });
      if (req.method !== 'POST') return send(res, 405, { error: 'use POST' });

      const header = req.headers['x-causewise-secret'];
      if (!secretMatches(Array.isArray(header) ? header[0] : header, deps.webhookSecret)) {
        deps.log({ event: 'alert_rejected', reason: 'bad secret' });
        return send(res, 401, { error: 'unauthorized' });
      }

      const raw = await readBody(req);
      if (raw === null) return send(res, 413, { error: 'body too large' });
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: 'body is not valid JSON' });
      }

      const parsed = parseAlert(json);
      if (!parsed.ok) {
        deps.log({ event: 'alert_rejected', reason: parsed.error });
        return send(res, 400, { error: parsed.error });
      }
      if ('ignored' in parsed) return send(res, 200, { status: 'ignored', reason: parsed.ignored });

      const outcome = deps.former.handle(parsed.alert, deps.now());
      deps.log({ event: 'alert', outcome, kind: parsed.alert.kind, event_id: parsed.alert.eventId, host: parsed.alert.host });
      return send(res, 200, { status: outcome });
    } catch (e) {
      deps.log({ event: 'error', message: (e as Error).message });
      return send(res, 500, { error: 'internal error' });
    }
  });
}
