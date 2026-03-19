# Tickle-Stick Core — Specification

## User Story

As an engineer running an agentic workflow such as OpenClaw, I want to
automatically triage inbound messages through a cost hierarchy so that simple
messages are handled cheaply and only complex messages trigger expensive agent
loops.

## Problem

Full agent loops cost ~$0.15 per invocation (heartbeat). Many inbound messages
— greetings, simple questions, spam, status checks — don't need intelligence.
Running them through a full agent loop wastes tokens and money.

**Example:** An email gateway checking 100 messages/day at $0.15/each =
$15/day = **$450/month** just for email triage.

## Solution

A 4-tier sequential interceptor pipeline:

| Tier | Name          | Cost    | Latency  | Method                           |
| ---- | ------------- | ------- | -------- | -------------------------------- |
| 0    | Deterministic | Free    | <10ms    | Regex, keyword, command matching |
| 1    | Cheap Triage  | ~$0.001 | <2s      | Small/cheap LLM classification   |
| 2    | Full Agent    | ~$0.15  | Variable | Passthrough to host agent loop   |
| 3    | Human         | Free    | N/A      | Escalation to human via webhook  |

Messages flow through tiers sequentially. The first tier that returns a
definitive result short-circuits the pipeline. Tier 2 is the "no match"
fallback. Tier 3 is triggered by Tier 1 returning "human".

## Scope

### In scope

- Core interceptor pipeline (sequential short-circuit)
- Tier 0: regex, keyword, slash-command matching with configurable patterns
- Tier 1: cheap model triage with provider abstraction
- Tier 2: passthrough (no-op, returns control to host)
- Tier 3: human escalation decision (host handles actual dispatch)
- YAML-based configuration with Zod validation
- Env var interpolation in config
- Provider interface (`TriageProvider`) — host injects concrete providers
- Structured telemetry logging (tier, latency, cost, outcome)
- `parseTriageResponse` utility for hosts building providers

### Out of scope (v1)

- Concrete model providers (Anthropic, OpenAI, etc.) — host responsibility
- Host-specific plugin entry points — glue code lives in the host (e.g., OpenClaw plugin adapter), not in this library
- Web dashboard for telemetry
- Multi-step triage (Tier 1 calling Tier 1 again)
- Message transformation / rewriting between tiers
- Rate limiting or throttling
- Authentication / authorization layer

## Kill Criteria

Ship if:

- All 4 tiers work end-to-end with tests passing
- Config loads from YAML with validation
- `TriageProvider` interface is clean enough that a host can implement it in <20 lines
- Telemetry logs tier decisions with cost estimates
- README tells the story in <60 seconds

Kill if:

- Cost savings are <50% in realistic email triage scenarios
- No external interest after 2 weeks of launch effort
