# Tickle-Stick — Claude Code Configuration

## Project

Tickle-stick: cost-hierarchy extension for agentic workflows.
4-tier triage pipeline: deterministic → cheap model → full agent → human.

## Strategy tier

**T0.** Pipeline and budget primitives the scheduled routines are built on.

**T0 expiry condition:** work here must name the specific T1 or T2 item it
unblocks.

Band rationale: `code-workspace-config/docs/strategy/portfolio.md`. Canonical
strategy: `code-workspace-config/docs/strategy/README.md`. Strategy is stated in
prose there and nowhere else — do not restate or paraphrase it here.

## Spec

All implementation is spec-driven. Read `.specify/specs/tickle-stick-core/`
before making changes.

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
