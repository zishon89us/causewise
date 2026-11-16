#!/usr/bin/env node
// A stand-in for the Claude Messages API with a fixed, dumb policy, used to
// exercise the investigation loop, the eval runner and the service wiring
// end to end without an API key. It says nothing about model quality.
//
//   node e2e/mock-anthropic.mjs [port]     (default 8799)
//
// Policy: on the first turn ask for the metrics of the first host named in
// the open problems; on the next turn submit an "undetermined" diagnosis
// that cites query 1.
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8799);
let n = 0;
createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw);
    const turns = body.messages.filter((m) => m.role === 'assistant').length;
    const opening = typeof body.messages[0].content === 'string' ? body.messages[0].content : '';
    const host = /\d\d:\d\d:\d\d \([^)]*\)\s+\w+\s+(\S+)/.exec(opening)?.[1] ?? 'web-01';
    const content =
      turns === 0
        ? [{ type: 'text', text: `Looking at ${host}.` }, { type: 'tool_use', id: `toolu_${++n}`, name: 'items', input: { host } }]
        : [{
            type: 'tool_use', id: `toolu_${++n}`, name: 'submit_diagnosis',
            input: {
              verdict: 'undetermined', causes: [], unrelated_alerts: [], ruled_out: [`${host} was looked at by a mock model`],
              evidence: [{ claim: 'Open problems were listed', query: 1 }], next_step: 'Run with a real model.',
            },
          }];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: `msg_${n}`, type: 'message', role: 'assistant', model: body.model, content, stop_reason: 'tool_use', stop_sequence: null,
      usage: { input_tokens: 2000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }));
  });
}).listen(port, '127.0.0.1', () => console.log(`mock Anthropic API on http://127.0.0.1:${port}`));
