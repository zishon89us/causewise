// The investigation loop (ADR 0006): a model calls read-only tools within a
// budget and finishes by submitting a diagnosis.
import { type Diagnosis, SUBMIT_DIAGNOSIS, validateDiagnosis } from './diagnosis.ts';
import { addUsage, NO_USAGE, type LlmClient, type ToolResult, type ToolSpec, type Turn, type Usage } from './llm.ts';
import { BudgetExceededError, type Investigation, TOOL_SPECS, ToolInputError } from './tools.ts';
import { ZabbixApiError } from './zabbix/client.ts';

export interface InvestigateOptions {
  llm: LlmClient;
  investigation: Investigation;
  /** The system prompt text (prompts/investigator). */
  system: string;
  /** How the incident is named to the model and in the result. */
  incident: string;
  /** Model turns before the loop gives up. Default 25. */
  maxTurns?: number;
}

export interface InvestigationResult {
  incident: string;
  diagnosis: Diagnosis;
  /** Why the loop stopped early, when verdict is 'incomplete'. */
  stoppedBecause?: string;
  queries: number;
  turns: number;
  usage: Usage;
  /** Models that served turns; more than one means a fallback ran. */
  models: string[];
}

const TOOLS: ToolSpec[] = [...TOOL_SPECS.map((t) => ({ ...t, input_schema: { ...t.input_schema } })), SUBMIT_DIAGNOSIS];

// Every investigation starts from the same three facts, so fetch them up
// front instead of spending model turns on them.
const OPENING: Array<[string, Record<string, unknown>]> = [['problems', {}], ['events', { minutes: 30 }], ['hosts', {}]];

const incomplete = (reason: string): Diagnosis => ({
  verdict: 'incomplete',
  causes: [],
  unrelated_alerts: [],
  ruled_out: [],
  evidence: [],
  next_step: `The investigation did not finish (${reason}). Investigate by hand.`,
});

export async function investigate(opts: InvestigateOptions): Promise<InvestigationResult> {
  const { llm, investigation, incident } = opts;
  const maxTurns = opts.maxTurns ?? 25;
  let usage = NO_USAGE;
  let turns = 0;
  const models = new Set<string>();
  const done = (diagnosis: Diagnosis, stoppedBecause?: string): InvestigationResult => ({
    incident, diagnosis, ...(stoppedBecause ? { stoppedBecause } : {}),
    queries: investigation.log.length, turns, usage, models: [...models],
  });

  // Zabbix output is wrapped as data and numbered, so evidence can cite it.
  const sections: string[] = [];
  for (const [tool, args] of OPENING) {
    const output = await investigation.run(tool, args);
    sections.push(`<zabbix_data query="${investigation.log.length}" tool="${tool}">\n${output}\n</zabbix_data>`);
  }
  const opening = [
    `Incident ${incident}. You have just been paged. The three queries below have already been run for you.`,
    ...sections,
    'Investigate with the tools, then call submit_diagnosis.',
  ].join('\n\n');

  const session = llm.session({ system: opts.system, tools: TOOLS });
  let turn: Turn = await session.start(opening);
  let nudges = 0;
  let rejected = 0;

  for (;;) {
    turns++;
    usage = addUsage(usage, turn.usage);
    models.add(turn.model);
    if (turn.stop === 'refusal') return done(incomplete('the model provider declined the request'), 'refusal');
    if (turn.stop === 'max_tokens') return done(incomplete('the model ran out of output space'), 'max_tokens');
    if (turns >= maxTurns) return done(incomplete('too many turns'), 'max_turns');

    if (turn.toolCalls.length === 0) {
      // tool_choice cannot be forced on current Claude models, so ask.
      if (nudges++ >= 2) return done(incomplete('the model did not submit a diagnosis'), 'no_submission');
      turn = await session.reply([], 'You have not submitted a diagnosis. Call submit_diagnosis now with what you have found.');
      continue;
    }

    const results: ToolResult[] = [];
    let accepted: Diagnosis | null = null;
    let outOfBudget = false;
    for (const call of turn.toolCalls) {
      if (call.name === SUBMIT_DIAGNOSIS.name) {
        const errors = validateDiagnosis(call.input, investigation.log.length);
        if (errors.length === 0) {
          accepted = call.input as Diagnosis;
          results.push({ id: call.id, content: 'Diagnosis accepted.' });
        } else {
          rejected++;
          results.push({ id: call.id, isError: true, content: `Diagnosis not accepted:\n- ${errors.join('\n- ')}\nFix these and call submit_diagnosis again.` });
        }
        continue;
      }
      try {
        const input = (typeof call.input === 'object' && call.input !== null ? call.input : {}) as Record<string, unknown>;
        const output = await investigation.run(call.name, input);
        results.push({ id: call.id, content: `[query ${investigation.log.length}]\n${output}` });
      } catch (e) {
        if (e instanceof BudgetExceededError) {
          outOfBudget = true;
          results.push({ id: call.id, isError: true, content: 'Not run: the query budget for this incident is used up.' });
        } else if (e instanceof ToolInputError || e instanceof ZabbixApiError) {
          results.push({ id: call.id, isError: true, content: e.message });
        } else {
          throw e;
        }
      }
    }
    if (accepted) return done(accepted);
    if (rejected > 3) return done(incomplete('the model could not produce a valid diagnosis'), 'invalid_diagnosis');
    turn = await session.reply(
      results,
      outOfBudget ? 'The query budget is used up. Call submit_diagnosis now with what you have; say what you could not check.' : undefined,
    );
  }
}
