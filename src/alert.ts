// The payload the Zabbix webhook media type sends (zabbix/webhook.js), and
// its validation. Everything in it is untrusted text from Zabbix: it is
// stored and later shown to a model as data, never interpreted.

export interface Tag {
  tag: string;
  value: string;
}

export interface Alert {
  /** Zabbix problem event id. A recovery carries the id of the problem it closes. */
  eventId: string;
  kind: 'problem' | 'recovery';
  name: string;
  /** 0 (not classified) to 5 (disaster). */
  severity: number;
  host: string;
  triggerId: string;
  tags: Tag[];
}

export type ParseResult =
  | { ok: true; alert: Alert }
  | { ok: true; ignored: string }
  | { ok: false; error: string };

const MAX_TEXT = 2048;
const MAX_TAGS = 64;

function text(v: unknown, field: string, max = MAX_TEXT): string {
  if (typeof v !== 'string') throw new Error(`${field} must be a string`);
  if (v.length > max) throw new Error(`${field} is longer than ${max} characters`);
  return v;
}

function parseTags(v: unknown): Tag[] {
  // Zabbix expands {EVENT.TAGSJSON} to a JSON array inside a string parameter.
  if (v === undefined || v === '') return [];
  let list: unknown = v;
  if (typeof v === 'string') {
    try {
      list = JSON.parse(v);
    } catch {
      throw new Error('tags is not valid JSON');
    }
  }
  if (!Array.isArray(list)) throw new Error('tags must be an array');
  if (list.length > MAX_TAGS) throw new Error(`more than ${MAX_TAGS} tags`);
  return list.map((t, i) => {
    if (typeof t !== 'object' || t === null) throw new Error(`tags[${i}] must be an object`);
    const { tag, value } = t as Record<string, unknown>;
    return { tag: text(tag, `tags[${i}].tag`, 255), value: text(value ?? '', `tags[${i}].value`, 255) };
  });
}

export function parseAlert(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;
  try {
    // "1" marks an update (acknowledgement, comment, severity change), which
    // is not a new alert.
    if (b.event_update_status === '1') return { ok: true, ignored: 'problem update' };

    const eventId = text(b.event_id, 'event_id', 32);
    if (!/^\d+$/.test(eventId)) throw new Error('event_id must be numeric');
    const value = text(b.event_value, 'event_value', 1);
    if (value !== '0' && value !== '1') throw new Error('event_value must be "0" or "1"');
    const severity = Number(text(b.severity, 'severity', 1));
    if (!Number.isInteger(severity) || severity < 0 || severity > 5) {
      throw new Error('severity must be 0 to 5');
    }
    const name = text(b.event_name, 'event_name');
    const host = text(b.host, 'host', 255);
    if (name === '' || host === '') throw new Error('event_name and host must not be empty');
    return {
      ok: true,
      alert: {
        eventId,
        kind: value === '1' ? 'problem' : 'recovery',
        name,
        severity,
        host,
        triggerId: text(b.trigger_id ?? '', 'trigger_id', 32),
        tags: parseTags(b.tags),
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
