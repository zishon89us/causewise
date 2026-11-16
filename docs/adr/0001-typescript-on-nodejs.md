# ADR 0001: TypeScript on Node.js

Date: 2026-11-16 · Status: proposed (awaiting maintainer approval)

## Context
One small service: a webhook receiver, an agent loop and chat delivery. The M0 simulator and query tool are already JavaScript with no dependencies.

## Options
- TypeScript on Node.js LTS.
- Python: strong for data work, but adds a second language to the repo.
- Go: single static binary, but slower to iterate on prompts and schemas.

## Decision
TypeScript, strict mode, on the current Node.js LTS. Keep dependencies few: an HTTP server, a schema validator, a SQLite driver, the model provider SDK.

## Consequences
The simulator, tools and product share code. Distribution is a container image, not a single binary.
