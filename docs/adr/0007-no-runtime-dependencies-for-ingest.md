# ADR 0007: No runtime dependencies for ingest

Date: 2026-11-16 · Status: proposed (awaiting maintainer approval)

## Context
ADR 0001 expected an HTTP framework, a schema validator and a SQLite
driver. For M2 the service is one webhook route, one health route and three
tables. Node.js 22 runs TypeScript files directly (type stripping) and
ships an HTTP server, a test runner and SQLite.

## Options
- Fastify, a validator library and `better-sqlite3`, compiled with `tsc`.
- Built-ins only: `node:http`, hand-written validation, `node:sqlite`,
  `node:test`, sources run directly.

## Decision
Built-ins only for M2. The only packages are development tools:
`typescript` (Apache-2.0) for type checking and `@types/node` (MIT).
Requires Node.js 22.18 or newer.

## Consequences
- Nothing to audit at runtime, no native build step, a small image.
- `node:sqlite` is marked experimental in Node 22 and prints a warning,
  which the start command suppresses. Its API may change; the store is the
  only module that touches it, so swapping the driver is contained.
- Type stripping allows only erasable TypeScript syntax (no enums or
  parameter properties); `erasableSyntaxOnly` enforces that.
- Revisit when M3 adds the model provider SDK, which will be the first
  runtime dependency.
