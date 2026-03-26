# Tickle-Stick — Agent Policy

## GitHub

- **Owner:** Kromatic-Innovation
- **Repo:** tickle-stick

## Project overview

Tickle-stick is an opinionated cost-hierarchy extension for agentic workflows.
It intercepts inbound messages and triages them through a 4-tier pipeline:

- **Tier 0** — Deterministic (regex, keywords, commands). Free, <10ms.
- **Tier 1** — Cheap model triage (Haiku / nano / local). ~$0.001, <2s.
- **Tier 2** — Full agent loop (passthrough). ~$0.15.
- **Tier 3** — Human escalation (email/Slack/webhook). Free.

## Branch policy

Inherits from `$WORKSPACE/policies/branch-and-promotion.md`:

- Feature work on `codex/feature/<topic>` branches
- Merge to `develop` with merge commit
- Promotion: `develop → staging → main` (fast-forward only)

## Spec-driven development

All implementation follows `.specify/specs/tickle-stick-core/`.
Read `spec.md` for scope, `plan.md` for architecture, `contracts/` for interfaces.

## Testing

- Unit tests in `test/` using Vitest
- All tiers, config, interceptor, and providers must have test coverage
- Run: `npm test`

## Key conventions

- TypeScript strict mode
- Zod for runtime validation
- YAML config with env var interpolation
- Structured JSON logging for telemetry
