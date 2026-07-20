# Changelog

All notable changes to Tickle-Stick are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] — 2026-07-20

Documentation, tooling, and OSS-readiness release. No runtime or published-API
changes — the `onError` triage-classifier behavior shipped in 0.6.0 (#84).

### Changed

- **`onError` hook documentation** — the README now documents the triage
  classifier's `onError(stage, err, "stage")` behavior added in 0.6.0. (#97)
- **Cost-claim reconciliation** — the README intro said "$216/month" while the
  Cost Comparison table anchors on "$15.00/day" ($450/mo); the intro is
  corrected to $15/day / $450/month with a one-line methodology note so the two
  figures agree.
- **Telemetry docs reconciliation** — clarified that telemetry is on by default,
  so a plain `node quickstart.mjs` emits structured JSON (one line per stage
  plus one per classified item), not only the elided clean block.

### Added

- **Issue templates** — bug-report and feature-request templates for the public
  repo. (#87, #88)
- **OSS-readiness CI** — continuous-integration checks that guard the
  open-source release surface. (#98, #99)

### Removed

- **Untracked internal spec-kit scaffolding** — `.specify/` is now gitignored;
  the spec-driven-dev artifacts are not needed by consumers of the published
  package.

## [0.6.0] — 2026-07-17

### Changed

- **Cheap-model `classify()` failures now surface via `onError`.** A throw from
  the triage stage's `classify()` was previously swallowed by a bare `catch {}`
  in `stage-router.ts`; it now fires the existing
  `PipelineOptions.onError(stage, err, "stage")` hook. `StageResult.errored` and
  `output.errors` semantics are unchanged. This extends the "no silently
  swallowed stage errors" work from 0.5.0 to the triage classifier. (#84)
- **Dev-toolchain bumps** (no runtime or published-API impact): `@types/node` →
  ^26, `eslint` → ^10, `typescript` → ^6, `vitest` → ^4, plus grouped
  dependabot patch/minor updates. (#85, #86, #90, #91)
- **`AGENTS.md` split** into an OSS-safe public file plus a gitignored internal
  overlay (`AGENTS.local.md`); the published package and public repo carry no
  Kromatic-internal guidance. (#83)

## [0.5.0] — 2026-06-18

> **Breaking under pre-1.0 SemVer.** This release changes `$file:` config
> resolution (now contained to the config directory) and how script-stage
> failures surface. Per [SemVer §4](https://semver.org/#spec-item-4) a `0.x`
> consumer should review **Changed** before upgrading.

### Added

- **`StageResult.errored`** — `true` when a script stage's command fails
  (timeout, non-zero exit, spawn error, or non-`WorkItem[]` output). Lets
  consumers distinguish a failed gather from a legitimately empty one; both
  still yield zero items. (#69)

### Changed

- **Script-stage failures are no longer silently swallowed.** `runScript` /
  `runPipedScript` failures now fire the existing
  `PipelineOptions.onError(stage, err, "stage")` hook, set
  `StageResult.errored`, and emit telemetry `action: "error"` instead of
  `"empty"`. Resolves the "silent stage-error swallowing" 1.0 yellow-flag
  from [#34](https://github.com/Kromatic-Innovation/tickle-stick/issues/34).
  (#69)
- **`$file:` config references are contained to the config directory.** A
  reference resolving outside the config-directory subtree (via `..` or an
  absolute path) now throws instead of inlining an arbitrary file into the
  config. Same-directory and nested references are unaffected. (#73)
- **Undefined environment variables in config now warn.** `${UNDEFINED_VAR}`
  still substitutes an empty string (non-breaking) but logs a one-line
  stderr warning naming the undefined vars. (#69)

### Fixed

- **`runPipedScript` could crash the host process** with an unhandled `EPIPE`
  when a piped script exited before draining stdin. Added the missing stdin
  error guard (mirroring `post-hook.ts`). (#65)
- **Prompt templates with repeated `{{items}}` / `{{all_items}}`
  placeholders** substituted only the first occurrence, shipping the literal
  token to the expensive model for the rest. All occurrences are now
  substituted. (#66)
- **Budget day/week boundaries ignored the configured `timezone`** — they
  were anchored to midnight UTC, skewing windows by the zone offset for any
  non-UTC deployment. Boundaries are now computed at local midnight in the
  configured zone (DST-correct). UTC behavior is byte-identical. (#67)
- **A single malformed element in script output discarded the whole batch.**
  `parseScriptOutput` now skips `null` / primitive / array elements
  individually and keeps the valid items. (#73)

### Security

- **SHA-pinned the GitHub Actions** in `ci.yaml` and
  `dependabot-auto-merge.yml` (the latter holds `contents: write` +
  `pull-requests: write`), consistent with `release.yml`'s existing pin
  policy. Also made coverage runnable from a clean install and enforced in
  CI. (#71)
- **Dev-toolchain major bumps** ride along with this release (dev-only, not in
  the published tarball): `eslint` 9→10, `typescript` 5.7→6, `vitest` 3→4,
  `@types/node` 22→25. Noted here for a clean bisect story.

## [0.4.2] — 2026-04-29

> **Breaking under pre-1.0 SemVer.** Despite the patch-level version digit,
> this release removes public exports and a parser behavior (see **Removed**
> below). Per [SemVer §4](https://semver.org/#spec-item-4), `0.x` releases
> make no stability guarantee and a `0.x` consumer should treat any minor or
> patch bump as potentially breaking. The patch digit is a deliberate 0.x
> exception, not a signal that this is a drop-in upgrade — review **Removed**
> and **Deprecated** before upgrading.

### Added

- **`Classification` type alias** and runtime `CLASSIFICATIONS` tuple
  exposed from `src/index.ts` so consumers can write exhaustive `switch`
  statements over `"routine" | "urgent" | "needs-reasoning"`. (#39 / #34)
- **`PipelineOptions.onError?: (stage, err, phase) => void`** — observe
  silent stage and post-hook errors that the pipeline still swallows.
  Phase distinguishes `"stage"` from `"post-hook"`. (#39 / #34)
- **`StageConfig.costPerInputToken` / `.costPerOutputToken` /
  `.defaultCostEstimate`** — configurable per-token pricing, replacing
  the hardcoded Haiku/4o-mini constants. Defaults match the previous
  values so existing 0.x consumers see no behavior change. (#40 / #34)
- **`ExpensiveStageProvider`** type alias and
  `PipelineOptions.expensiveStageProvider` — symmetric counterpart to
  `triageProvider`. Same `Record<string, StageCallback>` shape; new name
  for parity. (#41 / #34)
- **`TelemetryEvent.provider` / `.model` / `.tokensIn` / `.tokensOut`** —
  optional fields populated automatically by `HttpTriageProvider` and
  threaded through `classifyItem` → `StageRouter.runCheapModel.emit`.
  Lets `StorageAdapter.writeEvent` consumers record per-API-call cost
  rows with full provider context. (#43)

### Changed

- **`StageConfig.input` filter validation** — Zod schema now rejects
  unrecognized filter strings instead of silently falling through to
  "all items". Valid forms: `"all"` or comma-separated
  `"classified:<value>"` tokens (values from `CLASSIFICATIONS`). (#39)
- **Auto-prune budget retention** — `BudgetManager` prunes
  retention-expired events automatically on the first `checkBudget()`
  of a process and on each subsequent day rollover.
  `pipeline.pruneBudgetEvents()` remains as a manual escape hatch. (#40)
- **`Pipeline` class split** — orchestration logic stays in
  `src/pipeline.ts` (231 lines, down from 489); per-stage execution
  moves to `src/pipeline/stage-router.ts`; helpers move to
  `src/pipeline/context.ts` and `src/pipeline/prompt-interpolator.ts`.
  No public-API changes. (#42 / #34)

### Removed

- **Legacy `"human"` classification shim** — removed from
  `parseClassificationResponse`. The pre-0.3 back-compat mapping is
  gone; `"human"` responses now hit the safe-default fallback
  (`needs-reasoning`, `confidence: 0`) like any other unknown value.
  Consumers still emitting `"human"` must update prompts to
  `"needs-reasoning"`. (#41)
- **Public exports of internal plumbing** — `BudgetManager`,
  `MetricsCollector`, `runScript`, `runPostHook`, `createLogger`, and
  `BudgetManagerOptions` are no longer re-exported from `src/index.ts`.
  Pre-flight grep across the workspace confirmed no consumer imports
  any of these from `tickle-stick`. (#41)

### Deprecated

- **`PipelineOptions.stageCallbacks`** — use `expensiveStageProvider`
  (same shape, parity name). The old field is kept for 0.4.x
  compatibility and will be removed in 1.0. (#41)

## [0.4.1] — 2026-04-26

CI infrastructure release — re-tag for trusted-publishing retry. No
behavior changes from `0.4.0`.

## [0.4.0] — 2026-04-26

### Added

- **`HttpTriageProvider.classifyRaw(text, systemPrompt): Promise<string>`** —
  returns the model's raw response text without running it through
  `parseClassificationResponse`. Use this when your system prompt asks the
  model for a JSON shape other than `{classification, response, confidence}`
  (e.g. MoSCoW triage, urgency classification, free-form parsing). Throws
  on transport / HTTP errors so callers own their fallback. Closes
  [#36](https://github.com/Kromatic-Innovation/tickle-stick/issues/36).
- **`TriageProvider.classifyRaw?`** — optional method on the provider
  interface. Existing in-process providers that only implement `classify()`
  continue to work; callers should feature-detect.

### Changed

- `HttpTriageProvider.classify()` now shares its fetch path with
  `classifyRaw()` via an internal `fetchModelBody()` helper. Behavior is
  unchanged — `classify()` still swallows errors into the
  `needs-reasoning` sentinel for backward compatibility.

## [0.3.0] — 2026-04-22

First public npm publish (public-beta). The core pipeline contract is
stable; a handful of public-surface edges are being tracked for `1.0`
stabilization in
[#34](https://github.com/Kromatic-Innovation/tickle-stick/issues/34).

### Added

- **Public `exports` map** in `package.json` so ESM bundlers resolve the
  entrypoint and types deterministically instead of falling back to
  `"main"` / `"types"` heuristics.
- **`files` allowlist** restricting the npm tarball to `dist/`, `src/`,
  `README.md`, and `LICENSE`. Drops the published tarball from 5.2 MB /
  131 files to ~42 kB / ~94 files and excludes internal scaffolding
  (`AGENTS.md`, `CLAUDE.md`, `.specify/`, `.github/`, `assets/*.png`).
- **`CONTRIBUTING.md`** — development setup, branch naming, and PR
  expectations.
- **`SECURITY.md`** — private vulnerability reporting flow via
  `team@kromatic.com`.
- **`CODE_OF_CONDUCT.md`** — Contributor Covenant 2.1.
- **`CHANGELOG.md`** — this file.
- **README "Requirements" section** documenting Node ≥ 20 and the
  `moduleResolution: "bundler"` / `"node16"` expectation for TypeScript
  consumers.
- **Self-contained quickstart** in the README — 15-25 lines, runs
  end-to-end with no external services, uses only public API.
- **README "Cheap vs. expensive stages" section** explaining the asymmetry
  between `triageProvider` (cheap) and `stageCallbacks[stageName]`
  (expensive). Tracked for 1.0 unification in
  [#34](https://github.com/Kromatic-Innovation/tickle-stick/issues/34).

### Changed

- **`config/tickle-stick.yaml`** now matches the current Zod schema
  (pipelines + stages shape). The prior `tier0/tier1` shape was rolled
  into the pre-0.3 refactor and will not validate.
- **README hero image** now references the absolute GitHub raw URL so the
  image renders on npmjs.com after `assets/` is excluded from the tarball.
- **`package.json.description`** aligned to "cost-hierarchy pipeline" so
  vocabulary matches the README.

### Removed

- **Empty `peerDependencies: {}` and `peerDependenciesMeta: {}`** from
  `package.json` — noise that had no effect on resolution.
- **`openclaw` keyword** from `package.json` — Kromatic-internal term;
  strangers won't search for it on npm.
- **`NanoClaw` / `OpenClaw` Host Compatibility table** from the README —
  Kromatic-internal hosts; not useful context for external consumers.
- **Stale `dist/` artifacts** (`interceptor.*`, `tiers/tier0-*`,
  `tiers/tier2-*`, `tiers/tier3-*`) from the pre-refactor codebase.
  Rebuilt clean before publish.

### Known — tracked for 1.0

- See [#34](https://github.com/Kromatic-Innovation/tickle-stick/issues/34)
  for the full yellow-flag list: over-exposed internal plumbing, silent
  stage-error swallowing, unnamed `Classification` union, legacy `"human"`
  shim in `parse.ts`, hardcoded Haiku pricing in `tier1-triage.ts`,
  489-line `Pipeline` class, unvalidated input-filter DSL, opt-in budget
  prune, asymmetric provider API.

[0.6.0]: https://github.com/Kromatic-Innovation/tickle-stick/releases/tag/v0.6.0
[0.5.0]: https://github.com/Kromatic-Innovation/tickle-stick/releases/tag/v0.5.0
[0.4.2]: https://github.com/Kromatic-Innovation/tickle-stick/releases/tag/v0.4.2
[0.4.1]: https://github.com/Kromatic-Innovation/tickle-stick/releases/tag/v0.4.1
[0.4.0]: https://github.com/Kromatic-Innovation/tickle-stick/releases/tag/v0.4.0
[0.3.0]: https://github.com/Kromatic-Innovation/tickle-stick/releases/tag/v0.3.0
