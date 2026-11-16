// The investigator's tools: read-only questions about one incident, each
// answered from the Zabbix API and rendered as text for a model.
//
// Lessons from the M0 and M1 pilots are built in:
// - every value is shown with its age, and each metric with how often it is
//   sampled, because slow-sampled metrics caused wrong inferences;
// - a metric that has stopped reporting is flagged, because silence can be
//   the finding;
// - event history includes resolved problems, because the cause may already
//   have recovered.
//
// `asOf` pins "now" to a past moment and nothing later is ever returned, so
// the same tools investigate replayed incidents in evals.
import type { ZabbixClient } from './zabbix/client.ts';

export interface InvestigationOptions {
  /** Epoch seconds to treat as now. Default: the real time. */
  asOf?: number;
  /** Hide host tags and groups, to model an estate with no recorded topology (evals only). */
  hideTags?: boolean;
  /** Maximum tool calls for this incident. Default 30. */
  maxQueries?: number;
  /** Clock in epoch seconds. */
  now?: () => number;
}

export interface QueryRecord {
  seq: number;
  tool: string;
  args: Record<string, unknown>;
  rows: number;
  output: string;
}

export class BudgetExceededError extends Error {
  constructor(max: number) {
    super(`query budget of ${max} reached`);
  }
}

export class ToolInputError extends Error {}

/** Tool definitions in the JSON Schema form model providers accept. */
export const TOOL_SPECS = [
  {
    name: 'problems',
    description: 'List every problem open right now: when it started, severity, host and name. Start here.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'events',
    description:
      'List trigger events, both PROBLEM and RESOLVED, in the last N minutes. Shows problems that have already recovered, which can be the cause of what is still open.',
    input_schema: {
      type: 'object',
      properties: { minutes: { type: 'integer', minimum: 1, maximum: 1440, description: 'Default 30.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'hosts',
    description: 'List all hosts with their groups and tags. Tags often record topology: upstream switch, hypervisor, storage, service.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'items',
    description:
      'List every metric on one host with its latest value, how old that value is and how often it is sampled. A value much older than its sampling interval means the metric has stopped reporting.',
    input_schema: {
      type: 'object',
      properties: { host: { type: 'string' } },
      required: ['host'],
      additionalProperties: false,
    },
  },
  {
    name: 'history',
    description: 'Samples of one metric on one host over the last N minutes, oldest first. Use it to see when something started changing.',
    input_schema: {
      type: 'object',
      properties: {
        host: { type: 'string' },
        key: { type: 'string', description: 'Item key exactly as shown by the items tool.' },
        minutes: { type: 'integer', minimum: 1, maximum: 1440, description: 'Default 30.' },
      },
      required: ['host', 'key'],
      additionalProperties: false,
    },
  },
  {
    name: 'triggers',
    description:
      'List the alert rules (triggers) on one host with their conditions. Shows the thresholds, and therefore what can be wrong without raising an alert.',
    input_schema: {
      type: 'object',
      properties: { host: { type: 'string' } },
      required: ['host'],
      additionalProperties: false,
    },
  },
  {
    name: 'maintenance',
    description: 'List maintenance windows active right now and the hosts they cover.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
] as const;

export type ToolName = (typeof TOOL_SPECS)[number]['name'];

const SEVERITY = ['not classified', 'info', 'warning', 'average', 'high', 'disaster'];
const MAX_MINUTES = 1440;
const MAX_SAMPLES = 240;

interface EventRow {
  eventid: string;
  clock: string;
  name: string;
  severity: string;
  value: string;
  r_eventid: string;
  hosts: Array<{ host: string }>;
}
interface ItemRow {
  itemid: string;
  key_: string;
  value_type: string;
  units: string;
}
interface HistoryRow {
  itemid: string;
  clock: string;
  value: string;
}

const hhmmss = (epoch: number): string => new Date(epoch * 1000).toISOString().slice(11, 19);

function duration(seconds: number): string {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

export class Investigation {
  readonly log: QueryRecord[] = [];
  private readonly client: ZabbixClient;
  private readonly opts: InvestigationOptions;

  constructor(client: ZabbixClient, opts: InvestigationOptions = {}) {
    this.client = client;
    this.opts = opts;
  }

  /** The moment this investigation treats as now, in epoch seconds. */
  get at(): number {
    return this.opts.asOf ?? (this.opts.now ? this.opts.now() : Math.floor(Date.now() / 1000));
  }

  /** Run a tool by name with untrusted arguments (they come from a model). */
  async run(tool: string, args: Record<string, unknown> = {}): Promise<string> {
    const max = this.opts.maxQueries ?? 30;
    if (this.log.length >= max) throw new BudgetExceededError(max);
    const { text, rows } = await this.dispatch(tool, args);
    this.log.push({ seq: this.log.length + 1, tool, args, rows, output: text });
    return text;
  }

  private dispatch(tool: string, args: Record<string, unknown>): Promise<{ text: string; rows: number }> {
    const str = (name: string): string => {
      const v = args[name];
      if (typeof v !== 'string' || v === '' || v.length > 255) throw new ToolInputError(`"${name}" must be a non-empty string`);
      return v;
    };
    const minutes = (): number => {
      const v = args.minutes ?? 30;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new ToolInputError('"minutes" must be a positive whole number');
      return Math.min(v, MAX_MINUTES);
    };
    switch (tool) {
      case 'problems': return this.problems();
      case 'events': return this.events(minutes());
      case 'hosts': return this.hosts();
      case 'items': return this.items(str('host'));
      case 'history': return this.history(str('host'), str('key'), minutes());
      case 'triggers': return this.triggers(str('host'));
      case 'maintenance': return this.maintenance();
      default: throw new ToolInputError(`unknown tool "${tool}"`);
    }
  }

  private rel(epoch: number): string {
    return `${duration(this.at - epoch)} ago`;
  }

  private async triggerEvents(from: number): Promise<Array<EventRow & { at: number; host: string }>> {
    const rows = await this.client.call<EventRow[]>('event.get', {
      source: 0, object: 0, time_from: from, time_till: this.at,
      output: ['eventid', 'clock', 'name', 'severity', 'value', 'r_eventid'],
      selectHosts: ['host'], sortfield: ['clock', 'eventid'],
    });
    // Events whose host has since been deleted carry no host; skip them.
    return rows.filter((e) => e.hosts.length > 0).map((e) => ({ ...e, at: Number(e.clock), host: e.hosts[0]!.host }));
  }

  private async problems(): Promise<{ text: string; rows: number }> {
    // Looks back 24 hours. A problem that has been open for longer is not
    // listed; it is unlikely to be the cause of a new incident.
    const events = await this.triggerEvents(this.at - 24 * 3600);
    const recoveredAt = new Map(events.filter((e) => e.value === '0').map((e) => [e.eventid, e.at]));
    const open = events.filter((e) => e.value === '1' && !((recoveredAt.get(e.r_eventid) ?? Infinity) <= this.at));
    const lines = open.map(
      (e) => `${hhmmss(e.at)} (${this.rel(e.at)})  ${SEVERITY[Number(e.severity)]!.padEnd(8)} ${e.host.padEnd(14)} ${e.name}`,
    );
    return {
      text: [`Open problems as of ${hhmmss(this.at)} UTC (${open.length}), oldest first:`, ...lines].join('\n'),
      rows: open.length,
    };
  }

  private async events(minutes: number): Promise<{ text: string; rows: number }> {
    const events = await this.triggerEvents(this.at - minutes * 60);
    const lines = events.map(
      (e) =>
        `${hhmmss(e.at)} (${this.rel(e.at)})  ${e.value === '1' ? 'PROBLEM ' : 'RESOLVED'} ${SEVERITY[Number(e.severity)]!.padEnd(8)} ${e.host.padEnd(14)} ${e.name}`,
    );
    return {
      text: [`Trigger events in the ${minutes} minutes before ${hhmmss(this.at)} UTC (${events.length}):`, ...lines].join('\n'),
      rows: events.length,
    };
  }

  private async hosts(): Promise<{ text: string; rows: number }> {
    const rows = await this.client.call<
      Array<{ host: string; tags: Array<{ tag: string; value: string }>; hostgroups?: Array<{ name: string }> }>
    >('host.get', { output: ['host'], selectTags: ['tag', 'value'], selectHostGroups: ['name'], sortfield: 'host' });
    const lines = rows.map((h) => {
      if (this.opts.hideTags) return h.host;
      const groups = (h.hostgroups ?? []).map((g) => g.name).join(', ');
      const tags = h.tags.map((t) => `${t.tag}=${t.value}`).join(' ');
      return `${h.host.padEnd(14)} groups: ${groups || '-'}  tags: ${tags || '-'}`;
    });
    if (this.opts.hideTags) lines.push('(no host groups or tags are recorded on this estate)');
    return { text: [`Hosts (${rows.length}):`, ...lines].join('\n'), rows: rows.length };
  }

  private async hostItems(host: string, key?: string): Promise<ItemRow[]> {
    return this.client.call<ItemRow[]>('item.get', {
      host, output: ['itemid', 'key_', 'value_type', 'units'], sortfield: 'key_',
      ...(key === undefined ? {} : { filter: { key_: key } }),
    });
  }

  /** Samples for numeric items, grouped by item id, within a window ending at `at`. */
  private async samples(items: ItemRow[], from: number): Promise<Map<string, HistoryRow[]>> {
    const byItem = new Map<string, HistoryRow[]>();
    // history.get reads one value type per call: 0 float, 3 unsigned integer.
    for (const type of ['0', '3']) {
      const ids = items.filter((i) => i.value_type === type).map((i) => i.itemid);
      if (ids.length === 0) continue;
      const rows = await this.client.call<HistoryRow[]>('history.get', {
        itemids: ids, history: Number(type), time_from: from, time_till: this.at,
        output: ['itemid', 'clock', 'value'], sortfield: 'clock',
      });
      for (const r of rows) {
        const list = byItem.get(r.itemid);
        if (list) list.push(r);
        else byItem.set(r.itemid, [r]);
      }
    }
    return byItem;
  }

  private async items(host: string): Promise<{ text: string; rows: number }> {
    const items = await this.hostItems(host);
    if (items.length === 0) return { text: `No such host, or no metrics on it: ${host}`, rows: 0 };
    const numeric = items.filter((i) => i.value_type === '0' || i.value_type === '3');
    const byItem = await this.samples(numeric, this.at - 3600);
    const lines = items.map((it) => {
      const key = it.key_.padEnd(28);
      if (!numeric.includes(it)) return `${key} (text metric, not shown)`;
      const rows = byItem.get(it.itemid) ?? [];
      const last = rows.at(-1);
      if (!last) return `${key} NO DATA in the last 60 minutes`;
      const clocks = rows.map((r) => Number(r.clock));
      const gaps = clocks.slice(1).map((c, i) => c - clocks[i]!);
      const every = gaps.length ? median(gaps) : null;
      const age = this.at - Number(last.clock);
      // Three missed samples in a row is treated as "stopped".
      const stale = every !== null && age > every * 3 + 30;
      const cadence = every === null ? 'sampling interval unknown' : `sampled every ~${duration(every)}`;
      return `${key} ${`${last.value}${it.units}`.padEnd(12)} ${this.rel(Number(last.clock)).padEnd(10)} ${cadence}${
        stale ? '  <-- STOPPED REPORTING' : ''
      }`;
    });
    return {
      text: [`Metrics on ${host} as of ${hhmmss(this.at)} UTC (latest value, its age, sampling interval):`, ...lines].join('\n'),
      rows: items.length,
    };
  }

  private async history(host: string, key: string, minutes: number): Promise<{ text: string; rows: number }> {
    const items = await this.hostItems(host, key);
    const item = items[0];
    if (!item) return { text: `No such metric: ${host} ${key}. Use the items tool to list keys.`, rows: 0 };
    if (item.value_type !== '0' && item.value_type !== '3') return { text: `${host} ${key} is a text metric; history is not shown.`, rows: 0 };
    let rows = (await this.samples([item], this.at - minutes * 60)).get(item.itemid) ?? [];
    const total = rows.length;
    // Thin evenly rather than truncate, so the whole window stays visible.
    if (total > MAX_SAMPLES) {
      const step = Math.ceil(total / MAX_SAMPLES);
      rows = rows.filter((_, i) => i % step === 0 || i === total - 1);
    }
    const lines = rows.map((r) => `${hhmmss(Number(r.clock))} (${this.rel(Number(r.clock))})  ${r.value}${item.units}`);
    const thinned = rows.length < total ? `, showing ${rows.length}` : '';
    const last = rows.at(-1);
    const tail = last ? `Latest sample is ${this.rel(Number(last.clock))}.` : 'No samples in this window.';
    return {
      text: [`${host} ${key}: ${total} samples in the ${minutes} minutes before ${hhmmss(this.at)} UTC${thinned}. ${tail}`, ...lines].join('\n'),
      rows: total,
    };
  }

  private async triggers(host: string): Promise<{ text: string; rows: number }> {
    const rows = await this.client.call<Array<{ description: string; expression: string; priority: string; status: string }>>(
      'trigger.get',
      { host, output: ['description', 'expression', 'priority', 'status'], expandExpression: true, sortfield: 'description' },
    );
    if (rows.length === 0) return { text: `No alert rules on ${host} (or no such host). Nothing on it can raise an alert.`, rows: 0 };
    const lines = rows.map(
      (t) => `${SEVERITY[Number(t.priority)]!.padEnd(8)} ${t.description}${t.status === '1' ? ' [DISABLED]' : ''}\n         when ${t.expression}`,
    );
    return { text: [`Alert rules on ${host} (${rows.length}):`, ...lines].join('\n'), rows: rows.length };
  }

  private async maintenance(): Promise<{ text: string; rows: number }> {
    const rows = await this.client.call<
      Array<{ name: string; active_since: string; active_till: string; hosts?: Array<{ host: string }>; hostgroups?: Array<{ name: string }> }>
    >('maintenance.get', { output: ['name', 'active_since', 'active_till'], selectHosts: ['host'], selectHostGroups: ['name'] });
    const active = rows.filter((m) => Number(m.active_since) <= this.at && this.at <= Number(m.active_till));
    if (active.length === 0) return { text: 'No maintenance window is active.', rows: 0 };
    const lines = active.map((m) => {
      const hosts = (m.hosts ?? []).map((h) => h.host);
      const groups = (m.hostgroups ?? []).map((g) => `group ${g.name}`);
      return `${m.name}: ${[...hosts, ...groups].join(', ') || 'no hosts listed'}`;
    });
    // A window's schedule (its time periods) is not evaluated here; a listed
    // window is within its active dates but may not be running this minute.
    return { text: [`Maintenance windows within their active dates (${active.length}):`, ...lines].join('\n'), rows: active.length };
  }
}
