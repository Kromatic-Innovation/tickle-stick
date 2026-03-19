# Tickle-Stick Core — Task Breakdown

## Legend

- `[P]` = Parallel-safe (no dependency on prior task completion)
- `[S]` = Sequential (depends on earlier tasks)
- `[x]` = Done

## Phase 1: Foundation

- [ ] [P] T1: Repo scaffold (package.json, tsconfig, CI, LICENSE, .gitignore, AGENTS.md)
- [ ] [P] T2: Write .specify/ spec
- [ ] [P] T18: Hero illustration

## Phase 2: Core Engineering

- [ ] [S] T8: Config schema (Zod), loader, env var interpolation, defaults
- [ ] [S] T3: Core interceptor pipeline
- [ ] [S] T4: Tier 0 — deterministic pattern matching
- [ ] [S] T5: Tier 1 — cheap model triage with provider abstraction
- [ ] [P] T6: Tier 2 — passthrough
- [ ] [S] T7: Tier 3 — human escalation routing
- [ ] [S] T9: Provider: Anthropic (Haiku)
- [ ] [S] T10: Provider: OpenAI
- [ ] [S] T15: Telemetry: structured logging + cost tracking
- [ ] [S] T16: Tests for all components

## Phase 3: Integration

- [ ] [S] T13: OpenClaw plugin entry point
- [ ] [P] T14: Companion SKILL.md
- [ ] [S] T20: GitHub Actions CI
- [ ] [S] T19: Email demo deployment

## Phase 4: Content

- [ ] [S] T17: README
- [ ] [S] K1: Blog post draft
