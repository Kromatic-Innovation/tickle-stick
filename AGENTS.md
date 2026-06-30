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

**Repo metadata** (promotion model, staging status, Sentry projects, traffic tier, autonomous-loop opt-in): see `~/Code/docs/project-registry.yaml` entry for `Kromatic-Innovation/tickle-stick`. Do not duplicate that metadata here.

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

1. **Enumerate local consumers.** Known consumer: **Voltaire** in
   `Kromatic-Innovation/code-workspace-config` (`voltaire/` triage —
   `src/pipeline.ts` `triageProvider.classify`, runner). Grep the workspace for
   other importers: `grep -rl "tickle-stick" ~/Code --include=*.ts --include=*.json -l`.
2. **Check each consumer against the change.** Pay special attention to the
   `text` passed into `provider.classify` (consumers may `JSON.parse` it),
   work-item/`summary` shape, and tier return contracts.
3. **File a GitHub issue in the CONSUMER's repo** for anything that might break,
   linking the tickle-stick change, BEFORE the consumer can silently rot. A
   silent break is worse than a loud one.
4. Bump the version per semver — a contract change is a MAJOR (or at least
   MINOR-with-migration-note), never a silent patch.

_Why this exists: a tickle-stick 0.5.0 change that prepended `[type: …]` context
to the classifier input broke Voltaire's `JSON.parse(text)` silently (the throw
was swallowed downstream), disabling its LLM tier for ~a month. cwc#816._

## Release process

Tickle-stick is slated for OSS release in 2026. The published surface
includes the wheel/package itself **and** its installation hooks (cron,
services, launchd) — release review must walk the install path, not just
the code.

Before any release tag (`vX.Y.Z`):

1. Confirm `develop` is at the intended release-candidate tip.
2. Run the workspace `/zenodotus` skill against this repo:
   ```
   /zenodotus --repo . --ref develop --version <X.Y.Z> --prior-tag <vA.B.C>
   ```
3. Zenodotus spawns a 4-persona no-context reviewer panel
   (drive-by installer, production evaluator, maintainer's maintainer,
   drive-by contributor) and writes a verdict to
   `.zenodotus/<version>/verdict.md`.
   - **Pass** → use the drafted `.zenodotus/<version>/tag-message.md` as
     the tag body; create `git tag vX.Y.Z` and push.
   - **Conditional** / **Fail** → fix the must-fix items on `develop`,
     re-run `/zenodotus`.
4. Tagging stays human-triggered. Zenodotus does not run `git tag`.

The `.zenodotus/` directory is gitignored — verdict artifacts are local
record, not durable repo state.
