// Provider-neutral interface to a tool-calling model (ADR 0004). A session
// owns its conversation history, so each provider can keep whatever it needs
// to replay (for Claude: thinking blocks, unchanged).

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: readonly string[]; additionalProperties?: boolean };
  /** Ask the provider to guarantee inputs match the schema, where supported. */
  strict?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  id: string;
  content: string;
  isError?: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface Turn {
  toolCalls: ToolCall[];
  text: string;
  /** 'refusal': the provider declined; 'max_tokens': output was cut off. */
  stop: 'tool_use' | 'end' | 'refusal' | 'max_tokens' | 'other';
  usage: Usage;
  /** The model that actually served this turn. */
  model: string;
}

export interface LlmSession {
  start(userText: string): Promise<Turn>;
  /** Send tool results, optionally followed by a note from the system running the loop. */
  reply(results: ToolResult[], note?: string): Promise<Turn>;
}

export interface LlmClient {
  session(opts: { system: string; tools: ToolSpec[] }): LlmSession;
}

export const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
});

export const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
