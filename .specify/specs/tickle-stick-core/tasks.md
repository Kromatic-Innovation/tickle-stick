# Tickle-Stick Core — Task Breakdown

## Legend

- `[P]` = Parallel-safe (no dependency on prior task completion)
- `[S]` = Sequential (depends on earlier tasks)
- `[x]` = Done

## Phase 1: Foundation

- [x] [P] T1: Repo scaffold (package.json, tsconfig, CI, LICENSE, .gitignore, AGENTS.md)
- [x] [P] T2: Write .specify/ spec
- [x] [P] T18: Hero illustration

## Phase 2: Core Engineering

- [x] [S] T8: Config schema (Zod), loader, env var interpolation, defaults
- [x] [S] T3: Core interceptor pipeline
- [x] [S] T4: Tier 0 — deterministic pattern matching
- [x] [S] T5: Tier 1 — cheap model triage with provider abstraction
- [x] [P] T6: Tier 2 — passthrough
- [x] [S] T7: Tier 3 — human escalation routing
- [x] [S] T15: Telemetry: structured logging + cost tracking
- [x] [S] T16: Tests for all components

## Phase 3: Integration

- [ ] [P] T14: Companion SKILL.md
- [ ] [S] T20: GitHub Actions CI
- [ ] [S] T19: Email demo deployment

## Phase 4: Content

- [x] [S] T17: README
- [ ] [S] K1: Blog post draft

## Descoped

- ~~T9: Provider: Anthropic (Haiku)~~ — concrete providers belong in the host (e.g., OpenClaw); tickle-stick ships the `TriageProvider` interface only
- ~~T10: Provider: OpenAI~~ — same as T9
- ~~T13: OpenClaw plugin entry point~~ — plugin glue belongs in the host (e.g., OpenClaw), not here; tickle-stick stays framework-agnostic
