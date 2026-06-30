# Tickle-Stick — Agent Policy

> **Internal contributors:** also read `AGENTS.local.md` (gitignored, not part
> of the OSS package) for internal policy and tooling references that don't
> belong in the public repo.

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

## Downstream consumers — breaking-change discipline (REQUIRED)

Tickle-stick is a SUBSTRATE: other repos compose against its published surface
(work-item shape, the `provider.classify(text, systemPrompt)` call + the exact
`text` it receives, tier behavior/return shapes, config schema, hooks). A change
here can silently break a consumer that catches/swallows errors.

**Before merging ANY change to the published surface or pipeline contract
(not just releases), you MUST:**

1. **Enumerate downstream consumers** — every repo that imports or composes
   against this package.
2. **Check each consumer against the change.** Pay special attention to the
   `text` passed into `provider.classify` (consumers may `JSON.parse` it),
   work-item/`summary` shape, and tier return contracts.
3. **File a GitHub issue in the CONSUMER's repo** for anything that might break,
   linking the tickle-stick change, BEFORE the consumer can silently rot. A
   silent break is worse than a loud one.
4. Bump the version per semver — a contract change is a MAJOR (or at least
   MINOR-with-migration-note), never a silent patch.

_Why this exists: a past change that prepended extra context to the classifier
input broke a downstream consumer's `JSON.parse(text)` silently (the throw was
swallowed), disabling its cheap-model tier for ~a month before anyone noticed._

## Release process

Tickle-stick is slated for OSS release. The published surface includes the
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
