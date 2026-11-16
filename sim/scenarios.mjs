// Ten outage scenarios with a known cause. Each scenario is a function that
// says how the estate deviates from baseline at time t (seconds relative to
// the start of the fault; negative means before it).
//
// effect(host, key, t, rnd) returns:
//   undefined -> baseline value
//   null      -> no data (the host or check is not reporting)
//   number    -> the value to report (noise is added by the caller's `rnd`)
//
// THIS FILE CONTAINS THE ANSWERS. An investigator under evaluation must not
// read it.
import { namesByRole } from './topology.mjs';

const WEB = namesByRole('web');
const APP = namesByRole('app');
const BEHIND_SW02 = [...APP, 'db-01', 'db-02', 'cache-01', 'hv-01', 'dist-sw-02'];

const ramp = (t, t1, t2, v1, v2) => (t <= t1 ? v1 : t >= t2 ? v2 : v1 + ((v2 - v1) * (t - t1)) / (t2 - t1));
const j = (rnd, v, spread) => v + (rnd() * 2 - 1) * spread;

export const scenarios = [
  {
    name: 'switch-uplink-down',
    truth: { hosts: ['dist-sw-02'], summary: 'The link between core-rtr-01 and dist-sw-02 failed, cutting off everything behind dist-sw-02 (app, db, cache, hv-01). Web and load-balancer errors are symptoms.' },
    effect(host, key, t, rnd) {
      if (t < 0) return;
      if (BEHIND_SW02.includes(host)) {
        if (key === 'icmp.ping') return 0;
        if (key === 'icmp.loss.pct') return 100;
        return null;
      }
      if (host === 'core-rtr-01' && key === 'if.status[dist-sw-02]') return 0;
      if (WEB.includes(host) && key === 'http.5xx.pct') return j(rnd, 85, 5);
      if (WEB.includes(host) && key === 'http.resp.ms') return j(rnd, 120, 30);
      if (host === 'lb-01' && key === 'lb.5xx.pct') return j(rnd, 85, 5);
    },
  },
  {
    name: 'db-volume-full',
    truth: { hosts: ['db-01'], summary: 'The data volume on db-01 filled up (steady growth over the previous 90 minutes). Writes fail, so the apps log database errors, queues back up, the replica falls behind, and web and load balancer return 5xx.' },
    effect(host, key, t, rnd) {
      if (host === 'db-01' && key === 'fs.data.pct') return ramp(t, -5400, 0, 80, 100);
      if (t < 0) return;
      if (host === 'db-01' && key === 'db.conn.count') return j(rnd, 150, 10);
      if (host === 'db-02' && key === 'db.repl.lag.s') return ramp(t, 0, 600, 2, 600);
      if (APP.includes(host) && key === 'app.db.errors.rate') return j(rnd, 12, 3);
      if (APP.includes(host) && key === 'app.resp.ms') return j(rnd, 900, 100);
      if (APP.includes(host) && key === 'app.queue.depth') return ramp(t, 0, 300, 40, 1500);
      if (WEB.includes(host) && key === 'http.5xx.pct') return j(rnd, 40, 5);
      if (host === 'lb-01' && key === 'lb.5xx.pct') return j(rnd, 40, 5);
    },
  },
  {
    name: 'hypervisor-cpu-contention',
    truth: { hosts: ['hv-01'], summary: 'hv-01 is CPU-starved (CPU ready time jumped from about 2% to about 35%). Its guests app-01, app-02 and cache-01 slowed down, which slowed the web tier. No trigger exists on hv-01, so the cause is not among the alerts.' },
    effect(host, key, t, rnd) {
      if (t < 0) return;
      if (host === 'hv-01' && key === 'hv.cpu.ready.pct') return j(rnd, 35, 5);
      if (host === 'hv-01' && key === 'hv.cpu.util.pct') return j(rnd, 97, 2);
      if (['app-01', 'app-02'].includes(host) && key === 'app.resp.ms') return j(rnd, 2400, 300);
      if (['app-01', 'app-02'].includes(host) && key === 'app.queue.depth') return ramp(t, 0, 120, 40, 650);
      if (['app-03', 'app-04'].includes(host) && key === 'app.resp.ms') return j(rnd, 700, 80);
      if (host === 'cache-01' && key === 'cache.resp.ms') return j(rnd, 85, 10);
      if (WEB.includes(host) && key === 'http.resp.ms') return j(rnd, 2300, 200);
    },
  },
  {
    name: 'dns-resolver-slow',
    truth: { hosts: ['dns-01'], summary: 'dns-01 is overloaded (CPU about 96%) and resolving slowly (about 1.8 s per query). Every app call that needs a lookup is slow, which slows the web tier.' },
    effect(host, key, t, rnd) {
      if (t < 0) return;
      if (host === 'dns-01' && key === 'dns.query.ms') return j(rnd, 1800, 200);
      if (host === 'dns-01' && key === 'cpu.util.pct') return j(rnd, 96, 2);
      if (APP.includes(host) && key === 'app.resp.ms') return j(rnd, 2100, 200);
      if (APP.includes(host) && key === 'app.queue.depth') return j(rnd, 300, 40);
      if (WEB.includes(host) && key === 'http.resp.ms') return j(rnd, 2600, 200);
    },
  },
  {
    name: 'storage-latency',
    truth: { hosts: ['nas-01'], summary: 'nas-01 latency rose from about 4 ms to about 120 ms. db-01 stores its data there, so its I/O wait and slow queries rose, connections piled up, and the app and web tiers slowed.' },
    effect(host, key, t, rnd) {
      if (t < 0) return;
      if (host === 'nas-01' && key === 'nas.latency.ms') return j(rnd, 120, 15);
      if (host === 'nas-01' && key === 'nas.iops') return j(rnd, 300, 60);
      if (t < 60) return;
      if (host === 'db-01' && key === 'db.io.wait.pct') return j(rnd, 60, 6);
      if (host === 'db-01' && key === 'db.slow.queries.rate') return j(rnd, 45, 6);
      if (host === 'db-01' && key === 'db.conn.count') return ramp(t, 60, 180, 60, 195);
      if (APP.includes(host) && key === 'app.resp.ms') return j(rnd, 1900, 150);
      if (APP.includes(host) && key === 'app.queue.depth') return ramp(t, 60, 300, 40, 900);
      if (WEB.includes(host) && key === 'http.resp.ms') return j(rnd, 2400, 200);
    },
  },
  {
    name: 'app-memory-leak',
    truth: { hosts: ['app-03'], summary: 'app-03 has a memory leak: memory climbed for an hour, then the process began crash-looping (memory sawtooth), making app-03 slow. The low-disk alert on web-02 is older and unrelated.' },
    effect(host, key, t, rnd) {
      if (host === 'web-02' && key === 'fs.root.pct' && t >= -2400) return 91.5;
      if (host === 'app-03' && key === 'mem.util.pct') {
        if (t < 0) return ramp(t, -3600, 0, 55, 97);
        return 30 + (((t % 240) + 240) % 240) * (68 / 240);
      }
      if (t < 0) return;
      if (host === 'app-03' && key === 'app.resp.ms') return j(rnd, 5000, 500);
      if (host === 'app-03' && key === 'app.queue.depth') return ramp(t, 0, 120, 40, 600);
      if (host === 'lb-01' && key === 'lb.backends.healthy') return 3;
      if (WEB.includes(host) && key === 'http.5xx.pct') return j(rnd, 3, 1);
    },
  },
  {
    name: 'bad-deploy',
    truth: { hosts: APP, summary: 'A rolling deployment took the app tier from build 412 to 413 (app-01 first, then app-02, app-03, app-04, 90 seconds apart). Each node started logging database errors right after it was upgraded. The cause is the new build, not the database.' },
    effect(host, key, t, rnd) {
      if (t < 0) return;
      const deployed = (n) => t >= n * 90;
      const idx = APP.indexOf(host);
      if (idx >= 0 && deployed(idx)) {
        if (key === 'app.version') return 413;
        if (key === 'app.db.errors.rate') return j(rnd, 8, 2);
        if (key === 'app.resp.ms') return j(rnd, 1100, 100);
      }
      const share = APP.filter((_, n) => deployed(n)).length / APP.length;
      if (WEB.includes(host) && key === 'http.5xx.pct') return j(rnd, 48 * share, 3);
      if (host === 'lb-01' && key === 'lb.5xx.pct') return j(rnd, 48 * share, 3);
    },
  },
  {
    name: 'core-router-packet-loss',
    truth: { hosts: ['core-rtr-01'], summary: 'core-rtr-01 has a very high interface error rate (about 400/s). Every path crosses it, so all hosts show roughly 35% ping loss and flap as unreachable.' },
    effect(host, key, t, rnd) {
      if (t < 0) return;
      if (host === 'core-rtr-01') {
        if (key === 'if.errors.rate') return j(rnd, 400, 50);
        return;
      }
      if (key === 'icmp.loss.pct') return j(rnd, 35, 10);
      if (key === 'icmp.ping') return rnd() < 0.35 ? 0 : 1;
      if (WEB.includes(host) && key === 'http.resp.ms') return j(rnd, 1500, 200);
      if (host === 'dns-01' && key === 'dns.query.ms') return j(rnd, 300, 50);
    },
  },
  {
    name: 'two-independent-faults',
    truth: { hosts: ['cache-01', 'db-02'], summary: 'Two unrelated faults. (1) The cache service on cache-01 stopped (hit ratio 0, no response-time data), so every request hits the database and the app and web tiers slowed. (2) db-02, the replica, is overloaded by its own workload (CPU about 93%, slow queries) and is lagging; nothing depends on it in this incident.' },
    effect(host, key, t, rnd) {
      if (host === 'db-02' && t >= -120) {
        if (key === 'db.repl.lag.s') return ramp(t, -120, 120, 2, 400);
        if (key === 'cpu.util.pct') return j(rnd, 93, 2);
        if (key === 'db.slow.queries.rate') return j(rnd, 30, 4);
        if (key === 'db.io.wait.pct') return j(rnd, 30, 4);
      }
      if (t < 0) return;
      if (host === 'cache-01' && key === 'cache.hit.pct') return 0;
      if (host === 'cache-01' && key === 'cache.resp.ms') return null;
      if (host === 'db-01' && key === 'db.conn.count') return j(rnd, 150, 10);
      if (host === 'db-01' && key === 'db.slow.queries.rate') return j(rnd, 14, 2);
      if (host === 'db-01' && key === 'cpu.util.pct') return j(rnd, 70, 5);
      if (APP.includes(host) && key === 'app.resp.ms') return j(rnd, 1800, 150);
      if (WEB.includes(host) && key === 'http.resp.ms') return j(rnd, 2300, 200);
    },
  },
  {
    name: 'load-balancer-health-checks',
    truth: { hosts: ['lb-01'], summary: 'lb-01 marked all four backends unhealthy and returns 5xx for everything, while the web servers themselves are healthy (normal response times, no errors). The fault is on the load balancer (health check or configuration). The high-CPU alert on db-02 started 15 minutes earlier and is unrelated.' },
    effect(host, key, t, rnd) {
      if (host === 'db-02' && key === 'cpu.util.pct' && t >= -900) return j(rnd, 95, 2);
      if (host === 'db-02' && key === 'db.io.wait.pct' && t >= -900) return j(rnd, 30, 4);
      if (t < 0) return;
      if (host === 'lb-01' && key === 'lb.backends.healthy') return 0;
      if (host === 'lb-01' && key === 'lb.5xx.pct') return j(rnd, 100, 0);
    },
  },
];

// Timeline shared by every scenario (seconds relative to fault start).
export const TIMELINE = { start: -5400, faultEnds: 1200, end: 2100, pageAt: 360, spacing: 4 * 3600 };
