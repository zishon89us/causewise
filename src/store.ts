// SQLite store for alerts and incidents. One installation serves one Zabbix,
// so there is no tenancy. Uses Node's built-in SQLite (ADR 0007).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Alert } from './alert.ts';

export type IncidentState = 'settling' | 'ready' | 'closed';

export interface Incident {
  id: number;
  state: IncidentState;
  openedAt: number;
  settleUntil: number;
  readyAt: number | null;
  closedAt: number | null;
}

export interface StoredAlert extends Alert {
  receivedAt: number;
  recoveredAt: number | null;
  incidentId: number;
}

// Each entry runs once, in order; the index is stored in PRAGMA user_version.
const MIGRATIONS = [
  `CREATE TABLE incidents (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     state TEXT NOT NULL CHECK (state IN ('settling', 'ready', 'closed')),
     opened_at INTEGER NOT NULL,
     settle_until INTEGER NOT NULL,
     ready_at INTEGER,
     closed_at INTEGER
   );
   CREATE TABLE alerts (
     event_id TEXT PRIMARY KEY,
     incident_id INTEGER NOT NULL REFERENCES incidents(id),
     name TEXT NOT NULL,
     severity INTEGER NOT NULL,
     host TEXT NOT NULL,
     trigger_id TEXT NOT NULL,
     tags_json TEXT NOT NULL,
     received_at INTEGER NOT NULL,
     recovered_at INTEGER
   );
   CREATE INDEX alerts_incident ON alerts(incident_id);`,
];

interface IncidentRow {
  id: number;
  state: IncidentState;
  opened_at: number;
  settle_until: number;
  ready_at: number | null;
  closed_at: number | null;
}

const toIncident = (r: IncidentRow): Incident => ({
  id: r.id,
  state: r.state,
  openedAt: r.opened_at,
  settleUntil: r.settle_until,
  readyAt: r.ready_at,
  closedAt: r.closed_at,
});

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let v = row.user_version; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    }
  }

  close(): void {
    this.db.close();
  }

  /** Run fn inside one transaction. */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  hasAlert(eventId: string): boolean {
    return this.db.prepare('SELECT 1 FROM alerts WHERE event_id = ?').get(eventId) !== undefined;
  }

  /** The incident new alerts should join: the newest one that is not closed. */
  activeIncident(): Incident | null {
    const r = this.db
      .prepare("SELECT * FROM incidents WHERE state != 'closed' ORDER BY id DESC LIMIT 1")
      .get() as IncidentRow | undefined;
    return r ? toIncident(r) : null;
  }

  openIncident(now: number, settleUntil: number): Incident {
    const { lastInsertRowid } = this.db
      .prepare("INSERT INTO incidents (state, opened_at, settle_until) VALUES ('settling', ?, ?)")
      .run(now, settleUntil);
    return this.incident(Number(lastInsertRowid))!;
  }

  incident(id: number): Incident | null {
    const r = this.db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as IncidentRow | undefined;
    return r ? toIncident(r) : null;
  }

  incidents(): Incident[] {
    return (this.db.prepare('SELECT * FROM incidents ORDER BY id').all() as unknown as IncidentRow[]).map(toIncident);
  }

  addAlert(alert: Alert, incidentId: number, now: number): void {
    this.db
      .prepare(
        `INSERT INTO alerts (event_id, incident_id, name, severity, host, trigger_id, tags_json, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(alert.eventId, incidentId, alert.name, alert.severity, alert.host, alert.triggerId, JSON.stringify(alert.tags), now);
  }

  /** Returns false when the problem is unknown or already recovered. */
  markRecovered(eventId: string, now: number): boolean {
    const { changes } = this.db
      .prepare('UPDATE alerts SET recovered_at = ? WHERE event_id = ? AND recovered_at IS NULL')
      .run(now, eventId);
    return Number(changes) > 0;
  }

  alerts(incidentId: number): StoredAlert[] {
    const rows = this.db
      .prepare('SELECT * FROM alerts WHERE incident_id = ? ORDER BY received_at, event_id')
      .all(incidentId) as unknown as Array<{
      event_id: string; incident_id: number; name: string; severity: number; host: string;
      trigger_id: string; tags_json: string; received_at: number; recovered_at: number | null;
    }>;
    return rows.map((r) => ({
      eventId: r.event_id,
      kind: 'problem',
      name: r.name,
      severity: r.severity,
      host: r.host,
      triggerId: r.trigger_id,
      tags: JSON.parse(r.tags_json),
      receivedAt: r.received_at,
      recoveredAt: r.recovered_at,
      incidentId: r.incident_id,
    }));
  }

  /** Settling incidents whose settle window has passed become ready. */
  promoteSettled(now: number): Incident[] {
    const due = this.db
      .prepare("SELECT id FROM incidents WHERE state = 'settling' AND settle_until <= ?")
      .all(now) as Array<{ id: number }>;
    for (const { id } of due) {
      this.db.prepare("UPDATE incidents SET state = 'ready', ready_at = ? WHERE id = ?").run(now, id);
    }
    return due.map(({ id }) => this.incident(id)!);
  }

  /**
   * Close ready incidents where every alert recovered at least quietSeconds
   * ago. A settling incident is never closed: it is promoted first, so even a
   * short-lived outage is investigated.
   */
  closeQuiet(now: number, quietSeconds: number): Incident[] {
    const due = this.db
      .prepare(
        `SELECT i.id FROM incidents i
          WHERE i.state = 'ready'
            AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.incident_id = i.id AND a.recovered_at IS NULL)
            AND (SELECT MAX(a.recovered_at) FROM alerts a WHERE a.incident_id = i.id) <= ?`,
      )
      .all(now - quietSeconds) as Array<{ id: number }>;
    for (const { id } of due) {
      this.db.prepare("UPDATE incidents SET state = 'closed', closed_at = ? WHERE id = ?").run(now, id);
    }
    return due.map(({ id }) => this.incident(id)!);
  }
}
