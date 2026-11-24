# Tickle-Stick — Agent Policy

> **Internal contributors:** also read `AGENTS.local.md` (gitignored, not part
> of the OSS package) for internal policy and tooling references that don't
> belong in the public repo.

## Maintenance mode

Tickle-stick is in maintenance mode; 0.7.1 is the final planned release.

- Bug fixes and security fixes only. No feature work.
- No autonomous or scheduled build work against this repo.
- Docs corrections are welcome.

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

- Feature work on `codex/feature/<topic>` branches off `develop`.
- Merge to `develop` with a merge commit.

(Internal contributors: see `AGENTS.local.md` for the internal promotion model
and repo-metadata references.)

## Testing

- Unit tests in `test/` using Vitest
- All tiers, config, and providers must have test coverage
- Run: `npm test`

## Key conventions

- TypeScript strict mode
- Zod for runtime validation
- YAML config with env var interpolation
- Structured JSON logging for telemetry

## Published surface

Other projects may compose against the published surface (work-item shape, the
`provider.classify(text, systemPrompt)` call and the exact `text` it receives,
tier behavior and return shapes, config schema, hooks). In maintenance mode,
do not change that surface; a fix that would alter it needs an explicit,
documented decision and a version bump per semver.

## Release process

The published surface includes the
package itself **and** its installation hooks (cron, services, launchd) —
release review must walk the install path, not just the code.

Before any release tag (`vX.Y.Z`):

1. Confirm `develop` is at the intended release-candidate tip.
2. Run the project's release-review panel against the published surface
   (code + install path) — a no-context reviewer panel that produces a
   pass / conditional / fail verdict.
   - **Pass** → use the drafted tag body; create `git tag vX.Y.Z` and push.
   - **Conditional** / **Fail** → fix the must-fix items on `develop`, re-run
     the review.
3. Tagging stays human-triggered — the review panel never runs `git tag`.

(Internal contributors: the specific release-review tooling and invocation are
documented in `AGENTS.local.md`.)
