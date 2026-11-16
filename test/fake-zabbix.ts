// A tiny in-memory stand-in for the Zabbix JSON-RPC API, enough for the
// tools: it honours time_from/time_till, host and itemid filters.
export interface FakeData {
  hosts: Array<{ host: string; tags?: Array<{ tag: string; value: string }>; groups?: string[] }>;
  items: Array<{ itemid: string; host: string; key_: string; value_type?: string; units?: string }>;
  history: Array<{ itemid: string; clock: number; value: string }>;
  events: Array<{ eventid: string; clock: number; name: string; severity: number; value: 0 | 1; r_eventid?: string; host: string | null }>;
  triggers?: Array<{ host: string; description: string; expression: string; priority: string; status: string }>;
  maintenances?: Array<{ name: string; active_since: number; active_till: number; hosts: string[] }>;
}

export function fakeZabbix(data: FakeData) {
  const calls: Array<{ method: string; params: Record<string, any>; authorization: string | null }> = [];
  const handlers: Record<string, (p: Record<string, any>) => unknown> = {
    'event.get': (p) =>
      data.events
        .filter((e) => e.clock >= (p.time_from ?? 0) && e.clock <= (p.time_till ?? Infinity))
        .sort((a, b) => a.clock - b.clock)
        .map((e) => ({
          eventid: e.eventid, clock: String(e.clock), name: e.name, severity: String(e.severity),
          value: String(e.value), r_eventid: e.r_eventid ?? '0', hosts: e.host === null ? [] : [{ host: e.host }],
        })),
    'host.get': () =>
      data.hosts.map((h) => ({ host: h.host, tags: h.tags ?? [], hostgroups: (h.groups ?? []).map((name) => ({ name })) })),
    'item.get': (p) =>
      data.items
        .filter((i) => i.host === p.host && (p.filter?.key_ === undefined || p.filter.key_ === i.key_))
        .map((i) => ({ itemid: i.itemid, key_: i.key_, value_type: i.value_type ?? '0', units: i.units ?? '' })),
    'history.get': (p) =>
      data.history
        .filter((h) => p.itemids.includes(h.itemid) && h.clock >= p.time_from && h.clock <= p.time_till)
        .filter((h) => (data.items.find((i) => i.itemid === h.itemid)?.value_type ?? '0') === String(p.history))
        .sort((a, b) => a.clock - b.clock)
        .map((h) => ({ itemid: h.itemid, clock: String(h.clock), value: h.value })),
    'trigger.get': (p) => (data.triggers ?? []).filter((t) => t.host === p.host).map(({ host: _host, ...t }) => t),
    'maintenance.get': () =>
      (data.maintenances ?? []).map((m) => ({
        name: m.name, active_since: String(m.active_since), active_till: String(m.active_till),
        hosts: m.hosts.map((host) => ({ host })), hostgroups: [],
      })),
  };
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const { method, params, id } = JSON.parse(String(init?.body));
    calls.push({ method, params, authorization: new Headers(init?.headers).get('authorization') });
    const handler = handlers[method];
    const body = handler
      ? { jsonrpc: '2.0', result: handler(params), id }
      : { jsonrpc: '2.0', error: { message: 'Application error.', data: `No permissions to call "${method}".` }, id };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}
