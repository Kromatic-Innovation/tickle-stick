# Tickle-Stick — Claude Code Configuration

## Project

Tickle-stick: cost-hierarchy extension for agentic workflows.
4-tier triage pipeline: deterministic → cheap model → full agent → human.

## Maintenance mode

In maintenance mode: bug and security fixes only, no feature work. See
`AGENTS.md`.

## Commands

- `npm test` — run all tests
- `npm run build` — compile TypeScript
- `npm run lint` — lint source and tests
- `npm run typecheck` — type-check without emitting

## Conventions

- TypeScript strict mode, Node16 module resolution
- Zod schemas for config validation
- Provider interface pattern for model abstraction
- Structured JSON logging (no console.log in production code)
- Tests colocated in `test/` mirroring `src/` structure
