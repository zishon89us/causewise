// Minimal Zabbix client for the lab: JSON-RPC API over HTTP and the sender
// (trapper) protocol over TCP. No dependencies.
import net from 'node:net';

export const LABS = {
  '7.0': { api: 'http://127.0.0.1:8070/api_jsonrpc.php', trapperPort: 10070 },
  '8.0': { api: 'http://127.0.0.1:8080/api_jsonrpc.php', trapperPort: 10080 },
};

export class ZabbixApi {
  constructor(url) {
    this.url = url;
    this.auth = null;
    this.id = 0;
  }

  async call(method, params = {}) {
    const headers = { 'Content-Type': 'application/json-rpc' };
    if (this.auth) headers.Authorization = `Bearer ${this.auth}`;
    const res = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: ++this.id }),
    });
    const body = await res.json();
    if (body.error) {
      throw new Error(`${method}: ${body.error.message} ${body.error.data ?? ''}`);
    }
    return body.result;
  }

  async login(username = 'Admin', password = 'zabbix') {
    this.auth = await this.call('user.login', { username, password });
    return this;
  }
}

// Send values through the trapper port. Each value: {host, key, value, clock}.
export function send(port, values) {
  const payload = Buffer.from(
    JSON.stringify({
      request: 'sender data',
      data: values.map((v) => ({ ...v, value: String(v.value), ns: v.ns ?? 0 })),
      clock: Math.floor(Date.now() / 1000),
      ns: 0,
    }),
  );
  const header = Buffer.alloc(13);
  header.write('ZBXD\x01', 0, 'latin1');
  header.writeUInt32LE(payload.length, 5);
  header.writeUInt32LE(0, 9);
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    const chunks = [];
    sock.on('connect', () => sock.write(Buffer.concat([header, payload])));
    sock.on('data', (c) => chunks.push(c));
    sock.on('error', reject);
    sock.on('end', () => {
      const buf = Buffer.concat(chunks);
      try {
        resolve(JSON.parse(buf.subarray(13).toString()));
      } catch (e) {
        reject(new Error(`bad sender response: ${buf.toString()}`));
      }
    });
  });
}
