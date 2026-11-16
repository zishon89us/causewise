// The simulated estate: 19 hosts, their items, baselines and triggers.
// Every item is a Zabbix trapper item, so the simulator controls all values.

const SEV = { info: 1, warning: 2, average: 3, high: 4 };

// item: [key, baseline, noise (absolute, uniform +/-), interval seconds]
// trigger: [name, function-expression with {K} as the item reference, severity]
const COMMON = {
  items: [
    ['icmp.ping', 1, 0, 60],
    ['icmp.loss.pct', 0, 0, 60],
  ],
  triggers: [
    ['Unavailable by ICMP ping', 'max({icmp.ping},#3)=0', 'high'],
    ['High ICMP ping loss', 'min({icmp.loss.pct},#2)>20', 'warning'],
  ],
};

const SERVER = {
  items: [
    ['cpu.util.pct', 25, 8, 60],
    ['mem.util.pct', 55, 3, 60],
    ['fs.root.pct', 40, 0.2, 300],
  ],
  triggers: [
    ['High CPU utilization', 'min({cpu.util.pct},#3)>90', 'warning'],
    ['High memory utilization', 'min({mem.util.pct},#2)>90', 'average'],
    ['Disk space is low on /', 'last({fs.root.pct})>90', 'warning'],
  ],
};

const ROLES = {
  router: {
    items: [
      ['if.errors.rate', 0.5, 0.5, 60],
      ['if.status[dist-sw-01]', 1, 0, 60],
      ['if.status[dist-sw-02]', 1, 0, 60],
    ],
    triggers: [
      ['High interface error rate', 'min({if.errors.rate},#2)>50', 'warning'],
      ['Link down: to dist-sw-01', 'last({if.status[dist-sw-01]})=0', 'average'],
      ['Link down: to dist-sw-02', 'last({if.status[dist-sw-02]})=0', 'average'],
    ],
  },
  switch: {
    items: [
      ['if.uplink.status', 1, 0, 60],
      ['if.errors.rate', 0.5, 0.5, 60],
    ],
    triggers: [
      ['Uplink is down', 'last({if.uplink.status})=0', 'high'],
      ['High interface error rate', 'min({if.errors.rate},#2)>50', 'warning'],
    ],
  },
  lb: {
    server: true,
    items: [
      ['lb.backends.healthy', 4, 0, 60],
      ['lb.5xx.pct', 0.2, 0.2, 60],
    ],
    triggers: [
      ['Fewer than 2 healthy backends', 'last({lb.backends.healthy})<2', 'high'],
      ['High 5xx rate at load balancer', 'min({lb.5xx.pct},#2)>5', 'high'],
    ],
  },
  web: {
    server: true,
    items: [
      ['http.resp.ms', 450, 80, 60],
      ['http.5xx.pct', 0.2, 0.2, 60],
    ],
    triggers: [
      ['Slow HTTP response', 'min({http.resp.ms},#2)>2000', 'average'],
      ['High HTTP 5xx rate', 'min({http.5xx.pct},#2)>5', 'high'],
    ],
  },
  app: {
    server: true,
    items: [
      ['app.resp.ms', 350, 60, 60],
      ['app.db.errors.rate', 0, 0, 60],
      ['app.queue.depth', 40, 20, 60],
      ['app.version', 412, 0, 300],
    ],
    triggers: [
      ['Slow application response', 'min({app.resp.ms},#2)>1500', 'average'],
      ['Database errors in application', 'min({app.db.errors.rate},#2)>1', 'high'],
      ['Job queue is backing up', 'min({app.queue.depth},#3)>500', 'warning'],
      ['Application version has changed', 'change({app.version})<>0', 'info'],
    ],
  },
  db: {
    server: true,
    items: [
      ['db.conn.count', 60, 10, 60],
      ['db.slow.queries.rate', 2, 1.5, 60],
      ['db.repl.lag.s', 2, 2, 60],
      ['db.io.wait.pct', 5, 3, 60],
      ['fs.data.pct', 62, 0.1, 300],
    ],
    triggers: [
      ['Too many database connections', 'min({db.conn.count},#2)>180', 'warning'],
      ['High rate of slow queries', 'min({db.slow.queries.rate},#3)>20', 'warning'],
      ['Replication lag is high', 'min({db.repl.lag.s},#3)>60', 'average'],
      ['High disk I/O wait', 'min({db.io.wait.pct},#3)>40', 'warning'],
      ['Database volume is almost full', 'last({fs.data.pct})>95', 'high'],
    ],
  },
  cache: {
    server: true,
    items: [
      ['cache.hit.pct', 92, 3, 60],
      ['cache.resp.ms', 4, 2, 60],
    ],
    triggers: [
      ['Low cache hit ratio', 'max({cache.hit.pct},#3)<50', 'warning'],
      ['Slow cache response', 'min({cache.resp.ms},#2)>50', 'average'],
    ],
  },
  dns: {
    server: true,
    items: [['dns.query.ms', 20, 8, 60]],
    triggers: [['Slow DNS resolution', 'min({dns.query.ms},#2)>500', 'average']],
  },
  nas: {
    items: [
      ['nas.latency.ms', 4, 2, 60],
      ['nas.iops', 1800, 300, 60],
    ],
    triggers: [['High storage latency', 'min({nas.latency.ms},#3)>50', 'average']],
  },
  // Deliberate monitoring gap: the hypervisors report CPU ready time but
  // nobody wrote a trigger for it.
  hypervisor: {
    items: [
      ['hv.cpu.ready.pct', 2, 1, 60],
      ['hv.cpu.util.pct', 45, 8, 60],
    ],
    triggers: [],
  },
};

// name, role, tags (topology facts an operator would have recorded)
const HOSTS = [
  ['core-rtr-01', 'router', {}],
  ['dist-sw-01', 'switch', { upstream: 'core-rtr-01' }],
  ['dist-sw-02', 'switch', { upstream: 'core-rtr-01' }],
  ['lb-01', 'lb', { upstream: 'core-rtr-01', service: 'shop' }],
  ['dns-01', 'dns', { upstream: 'core-rtr-01' }],
  ['nas-01', 'nas', { upstream: 'core-rtr-01' }],
  ['hv-01', 'hypervisor', { upstream: 'dist-sw-02' }],
  ['hv-02', 'hypervisor', { upstream: 'dist-sw-01' }],
  ['web-01', 'web', { upstream: 'dist-sw-01', service: 'shop' }],
  ['web-02', 'web', { upstream: 'dist-sw-01', service: 'shop' }],
  ['web-03', 'web', { upstream: 'dist-sw-01', service: 'shop', hypervisor: 'hv-02' }],
  ['web-04', 'web', { upstream: 'dist-sw-01', service: 'shop', hypervisor: 'hv-02' }],
  ['app-01', 'app', { upstream: 'dist-sw-02', service: 'shop', hypervisor: 'hv-01' }],
  ['app-02', 'app', { upstream: 'dist-sw-02', service: 'shop', hypervisor: 'hv-01' }],
  ['app-03', 'app', { upstream: 'dist-sw-02', service: 'shop' }],
  ['app-04', 'app', { upstream: 'dist-sw-02', service: 'shop' }],
  ['db-01', 'db', { upstream: 'dist-sw-02', service: 'shop', storage: 'nas-01', 'db-role': 'primary' }],
  ['db-02', 'db', { upstream: 'dist-sw-02', service: 'shop', 'db-role': 'replica' }],
  ['cache-01', 'cache', { upstream: 'dist-sw-02', service: 'shop', hypervisor: 'hv-01' }],
];

export const hosts = HOSTS.map(([name, role, tags]) => {
  const r = ROLES[role];
  const parts = [COMMON, ...(r.server ? [SERVER] : []), r];
  return {
    name,
    role,
    tags: { role, ...tags },
    items: parts.flatMap((p) => p.items).map(([key, base, noise, interval]) => ({ key, base, noise, interval })),
    triggers: parts
      .flatMap((p) => p.triggers)
      .map(([tname, expr, sev]) => ({
        name: tname,
        severity: SEV[sev],
        // {key} -> /host/key
        expression: expr.replace(/\{([^}]+)\}/g, (_, k) => `/${name}/${k}`).replace(/(max|min|last|change)\(/g, '$1('),
      })),
  };
});

export const byName = Object.fromEntries(hosts.map((h) => [h.name, h]));
export const namesByRole = (role) => hosts.filter((h) => h.role === role).map((h) => h.name);
