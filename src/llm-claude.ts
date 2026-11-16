// Claude adapter for the LlmClient interface, on the official Anthropic SDK.
import Anthropic from '@anthropic-ai/sdk';
import type { LlmClient, LlmSession, ToolResult, ToolSpec, Turn } from './llm.ts';

import type { Effort } from './config.ts';

export type { Effort };

export interface ClaudeOptions {
  /** Default: the SDK reads ANTHROPIC_API_KEY from the environment. */
  apiKey?: string;
  baseURL?: string;
  model: string;
  effort: Effort;
  maxTokens?: number;
}


class ClaudeSession implements LlmSession {
  private readonly client: Anthropic;
  private readonly opts: ClaudeOptions;
  private readonly system: string;
  private readonly tools: Anthropic.Beta.BetaToolUnion[];
  private readonly messages: Anthropic.Beta.BetaMessageParam[] = [];

  constructor(client: Anthropic, opts: ClaudeOptions, system: string, tools: ToolSpec[]) {
    this.client = client;
    this.opts = opts;
    this.system = system;
    this.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: { ...t.input_schema, required: t.input_schema.required ? [...t.input_schema.required] : undefined },
      ...(t.strict ? { strict: true } : {}),
    }));
  }

  start(userText: string): Promise<Turn> {
    this.messages.push({ role: 'user', content: userText });
    return this.send();
  }

  reply(results: ToolResult[], note?: string): Promise<Turn> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = results.map((r) => ({
      type: 'tool_result',
      tool_use_id: r.id,
      content: r.content,
      ...(r.isError ? { is_error: true } : {}),
    }));
    // All results for one assistant turn go back in a single user message.
    if (note) content.push({ type: 'text', text: note });
    this.messages.push({ role: 'user', content });
    return this.send();
  }

  private async send(): Promise<Turn> {
    const response = await this.client.beta.messages.create({
      model: this.opts.model,
      max_tokens: this.opts.maxTokens ?? 16000,
      // If a safety classifier declines a request, let the API re-run it on
      // its default fallback model instead of failing the investigation.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: this.opts.effort },
      // The system prompt and tool list never change within an incident, and
      // history only grows, so cache the whole prefix on every turn.
      cache_control: { type: 'ephemeral' },
      system: this.system,
      tools: this.tools,
      messages: this.messages,
    });

    // Echo the assistant turn back unchanged, thinking blocks included.
    this.messages.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] });

    const toolCalls = response.content
      .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    const stop: Turn['stop'] =
      response.stop_reason === 'tool_use' ? 'tool_use'
      : response.stop_reason === 'end_turn' ? 'end'
      : response.stop_reason === 'refusal' ? 'refusal'
      : response.stop_reason === 'max_tokens' ? 'max_tokens'
      : 'other';
    return {
      // A refusal or a cut-off can leave a half-written tool call; never run it.
      toolCalls: stop === 'tool_use' ? toolCalls : [],
      text,
      stop,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

export class ClaudeClient implements LlmClient {
  private readonly client: Anthropic;
  private readonly opts: ClaudeOptions;

  constructor(opts: ClaudeOptions) {
    this.opts = opts;
    this.client = new Anthropic({
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
  }

  session(opts: { system: string; tools: ToolSpec[] }): LlmSession {
    return new ClaudeSession(this.client, this.opts, opts.system, opts.tools);
  }
}

/**
 * US dollars per million tokens, Anthropic first-party API, as listed on
 * 2026-11-03. Used only to report and cap spend; check current prices.
 */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** Estimated cost in US dollars, or null for a model with no listed price. */
export function estimateCostUsd(model: string, u: Turn['usage']): number | null {
  const p = PRICES[model];
  if (!p) return null;
  // Cache writes are billed at 1.25 times the input price.
  return (u.inputTokens * p.input + u.cacheWriteTokens * p.input * 1.25 + u.cacheReadTokens * p.cacheRead + u.outputTokens * p.output) / 1e6;
}
