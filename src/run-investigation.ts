// Glue between an incident becoming ready and a stored diagnosis.
import type { InvestigatorConfig } from './config.ts';
import { investigate, type InvestigationResult } from './investigator.ts';
import type { LlmClient } from './llm.ts';
import { estimateCostUsd } from './llm-claude.ts';
import type { Prompt } from './prompt.ts';
import type { Store } from './store.ts';
import { Investigation } from './tools.ts';
import type { ZabbixClient } from './zabbix/client.ts';

export interface InvestigatorDeps {
  store: Store;
  zabbix: ZabbixClient;
  llm: LlmClient;
  prompt: Prompt;
  config: Pick<InvestigatorConfig, 'model' | 'maxQueries'>;
  /** Epoch seconds. */
  now: () => number;
  log: (entry: Record<string, unknown>) => void;
}

/** Investigate one incident and store the result. Never throws: a failure is logged. */
export async function investigateIncident(deps: InvestigatorDeps, incidentId: number): Promise<InvestigationResult | null> {
  const { store, log } = deps;
  const investigation = new Investigation(deps.zabbix, { maxQueries: deps.config.maxQueries, now: deps.now });
  try {
    const result = await investigate({ llm: deps.llm, investigation, system: deps.prompt.text, incident: `#${incidentId}` });
    // Priced at the configured model; a turn served by a fallback model may cost differently.
    const costUsd = estimateCostUsd(deps.config.model, result.usage);
    store.saveInvestigation(incidentId, deps.now(), result, investigation.log, deps.prompt.version, costUsd);
    log({
      event: 'diagnosis', incident: incidentId, verdict: result.diagnosis.verdict,
      causes: result.diagnosis.causes.map((c) => `${c.host} (${c.confidence})`),
      ...(result.stoppedBecause ? { stopped_because: result.stoppedBecause } : {}),
      queries: result.queries, turns: result.turns, models: result.models, cost_usd: costUsd,
    });
    return result;
  } catch (e) {
    // The message of an SDK or Zabbix error never contains a credential.
    log({ event: 'investigation_failed', incident: incidentId, error: (e as Error).name, message: (e as Error).message });
    return null;
  }
}
