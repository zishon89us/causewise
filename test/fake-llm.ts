// A scripted LlmClient for tests: each step of the script produces the next
// model turn, and everything the loop sends is recorded.
import type { LlmClient, LlmSession, ToolCall, ToolResult, ToolSpec, Turn } from '../src/llm.ts';

export type Step = Partial<Omit<Turn, 'toolCalls'>> & { calls?: Array<[name: string, input: unknown]> };

export class FakeLlm implements LlmClient {
  system = '';
  tools: ToolSpec[] = [];
  opening = '';
  readonly replies: Array<{ results: ToolResult[]; note?: string }> = [];
  private readonly script: Step[];
  private n = 0;

  constructor(script: Step[]) {
    this.script = script;
  }

  private next(): Turn {
    const step = this.script[this.n++];
    if (!step) throw new Error('FakeLlm: script exhausted');
    const toolCalls: ToolCall[] = (step.calls ?? []).map(([name, input], i) => ({ id: `call_${this.n}_${i}`, name, input }));
    return {
      toolCalls,
      text: step.text ?? '',
      stop: step.stop ?? (toolCalls.length ? 'tool_use' : 'end'),
      model: step.model ?? 'fake-model',
      usage: step.usage ?? { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }

  session(opts: { system: string; tools: ToolSpec[] }): LlmSession {
    this.system = opts.system;
    this.tools = opts.tools;
    return {
      start: async (userText) => {
        this.opening = userText;
        return this.next();
      },
      reply: async (results, note) => {
        this.replies.push({ results, ...(note ? { note } : {}) });
        return this.next();
      },
    };
  }
}
