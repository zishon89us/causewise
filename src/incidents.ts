// Incident formation (ADR 0005): the first alert opens an incident, alerts
// that follow join it, and after a settle window the incident is ready to be
// investigated, once.
import type { Alert } from './alert.ts';
import type { Incident, Store } from './store.ts';

export type Outcome = 'accepted' | 'duplicate' | 'unknown-problem';

export interface FormerOptions {
  settleSeconds: number;
  quietSeconds: number;
  /** Called once per incident, when its settle window has passed. */
  onReady?: (incident: Incident) => void;
  onClosed?: (incident: Incident) => void;
}

export class IncidentFormer {
  private readonly store: Store;
  private readonly opts: FormerOptions;

  constructor(store: Store, opts: FormerOptions) {
    this.store = store;
    this.opts = opts;
  }

  /** Handle one alert at time `now` (epoch seconds). */
  handle(alert: Alert, now: number): Outcome {
    if (alert.kind === 'recovery') {
      return this.store.markRecovered(alert.eventId, now) ? 'accepted' : 'unknown-problem';
    }
    return this.store.transaction(() => {
      // Zabbix retries a webhook that failed or timed out, so the same event
      // can arrive more than once.
      if (this.store.hasAlert(alert.eventId)) return 'duplicate';
      const incident =
        this.store.activeIncident() ?? this.store.openIncident(now, now + this.opts.settleSeconds);
      this.store.addAlert(alert, incident.id, now);
      return 'accepted';
    });
  }

  /** Advance incident states. Call regularly. */
  tick(now: number): void {
    for (const incident of this.store.promoteSettled(now)) this.opts.onReady?.(incident);
    for (const incident of this.store.closeQuiet(now, this.opts.quietSeconds)) this.opts.onClosed?.(incident);
  }
}
