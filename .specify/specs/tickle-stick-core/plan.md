# Tickle-Stick Core — Architecture Plan

## Overview

Tickle-stick is a TypeScript library that exports an interceptor pipeline designed
for OpenClaw but compatible with any agentic framework. The host hooks it into
its inbound message flow and runs each message through a sequential 4-tier
pipeline. The first tier to return a definitive result wins.

## Architecture

```
InboundMessage
      │
      ▼
┌─────────────┐
│ Interceptor │  Orchestrates the pipeline
│  Pipeline   │  Loads config, initializes tiers
└──────┬──────┘
       │
  ┌────▼────┐    match? → return response
  │ Tier 0  │    Deterministic: regex/keyword/command
  └────┬────┘
       │ no match
  ┌────▼────┐    deflect/human? → handle
  │ Tier 1  │    Cheap model: classify → deflect|escalate|human
  └────┬────┘
       │ "escalate"
  ┌────▼────┐
  │ Tier 2  │    Passthrough → host agent loop
  └────┬────┘
       │ "human" (from Tier 1)
  ┌────▼────┐
  │ Tier 3  │    Return decision → host dispatches (email/Slack/webhook)
  └─────────┘
```

## Key Interfaces

### InboundMessage

The normalized input that flows through the pipeline.

```typescript
interface InboundMessage {
  id: string;
  channel: string; // "email" | "slack" | "webhook" | string
  from: string;
  subject?: string;
  body: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}
```

### TierResult

What each tier returns.

```typescript
interface TierResult {
  tier: 0 | 1 | 2 | 3;
  action: "deflect" | "escalate" | "human" | "passthrough";
  response?: string; // For deflect: the canned/generated response
  confidence?: number; // 0-1, for Tier 1 decisions
  costEstimate: number; // Estimated USD cost of this tier's processing
  latencyMs: number; // Processing time in ms
  metadata?: Record<string, unknown>;
}
```

### TriageProvider

The abstraction for Tier 1 model calls.

```typescript
interface TriageProvider {
  name: string;
  triage(message: InboundMessage, prompt: string): Promise<TriageDecision>;
}

interface TriageDecision {
  action: "deflect" | "escalate" | "human";
  response?: string;
  confidence: number;
  tokenUsage?: { input: number; output: number };
}
```

## Config Structure

YAML config with Zod validation. Env vars interpolated via `${ENV_VAR}` syntax.

```yaml
tickleStick:
  tier0:
    patterns:
      - match: "^(hi|hello|hey)$"
        type: regex
        flags: "i"
        action: deflect
        response: "Hello! How can I help you today?"
      - match: "/help"
        type: command
        action: deflect
        response: "Available commands: /help, /status, /escalate"
    keywords:
      - match: ["unsubscribe", "stop", "remove"]
        action: deflect
        response: "You've been unsubscribed."

  tier1:
    systemPrompt: |
      Classify this message. Respond with JSON:
      {"action": "deflect"|"escalate"|"human", "response": "...", "confidence": 0.0-1.0}
    confidenceThreshold: 0.7
    timeout: 5000

  # Tier 3 is decision-only — no config needed.
  # The host reads action: "human" from TierResult and dispatches
  # via its own email/Slack/webhook infrastructure.

  telemetry:
    enabled: true
    format: json
    includeMessagePreview: false

```

## Module Responsibilities

| Module                         | Responsibility                                              |
| ------------------------------ | ----------------------------------------------------------- |
| `interceptor.ts`               | Pipeline orchestration, tier sequencing, telemetry emission |
| `tiers/tier0-deterministic.ts` | Pattern matching against config rules                       |
| `tiers/tier1-triage.ts`        | Provider call, decision parsing, confidence check           |
| `tiers/tier2-passthrough.ts`   | No-op return signaling host should proceed                  |
| `tiers/tier3-human.ts`         | Returns human escalation decision (host dispatches)         |
| `config/schema.ts`             | Zod schema definition                                       |
| `config/loader.ts`             | YAML parse, env var interpolation, validation               |
| `config/defaults.ts`           | Sensible default config for quick start                     |
| `providers/provider.ts`        | TriageProvider interface re-exports                         |
| `providers/parse.ts`           | Shared `parseTriageResponse` utility                        |
| `telemetry/logger.ts`          | Structured tier decision logging                            |
| `telemetry/metrics.ts`         | Cost tracking, tier distribution stats                      |
| `index.ts`                     | Library entry point — barrel exports                        |

## Error Handling

- Tier 0: errors → skip to Tier 1 (pattern errors are config bugs, not runtime)
- Tier 1: provider timeout/error → fall through to Tier 2 (fail open)
- Tier 3: pure decision, no I/O — cannot fail
- Config: validation errors → throw at startup (fail fast)
