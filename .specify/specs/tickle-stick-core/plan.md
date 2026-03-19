# Tickle-Stick Core — Architecture Plan

## Overview

Tickle-stick is a TypeScript library that exports an OpenClaw plugin. The plugin
hooks into `dispatchInboundMessage` and runs each message through a sequential
4-tier pipeline. The first tier to return a definitive result wins.

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
  │ Tier 3  │    Route to human: webhook/email/Slack
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
    provider: anthropic
    model: claude-haiku-4-5-20251001
    systemPrompt: |
      Classify this message. Respond with JSON:
      {"action": "deflect"|"escalate"|"human", "response": "...", "confidence": 0.0-1.0}
    confidenceThreshold: 0.7
    timeout: 5000

  tier3:
    routes:
      - channel: webhook
        url: "${ESCALATION_WEBHOOK_URL}"
      - channel: email
        to: "team@example.com"

  telemetry:
    enabled: true
    format: json
    includeMessagePreview: false

  providers:
    anthropic:
      apiKey: "${ANTHROPIC_API_KEY}"
    openai:
      apiKey: "${OPENAI_API_KEY}"
```

## Module Responsibilities

| Module                         | Responsibility                                              |
| ------------------------------ | ----------------------------------------------------------- |
| `interceptor.ts`               | Pipeline orchestration, tier sequencing, telemetry emission |
| `tiers/tier0-deterministic.ts` | Pattern matching against config rules                       |
| `tiers/tier1-triage.ts`        | Provider call, decision parsing, confidence check           |
| `tiers/tier2-passthrough.ts`   | No-op return signaling host should proceed                  |
| `tiers/tier3-human.ts`         | Webhook/email/Slack dispatch                                |
| `config/schema.ts`             | Zod schema definition                                       |
| `config/loader.ts`             | YAML parse, env var interpolation, validation               |
| `config/defaults.ts`           | Sensible default config for quick start                     |
| `providers/provider.ts`        | TriageProvider interface                                    |
| `providers/anthropic.ts`       | Anthropic Haiku implementation                              |
| `providers/openai.ts`          | OpenAI implementation                                       |
| `telemetry/logger.ts`          | Structured tier decision logging                            |
| `telemetry/metrics.ts`         | Cost tracking, tier distribution stats                      |
| `index.ts`                     | OpenClaw plugin export                                      |

## Error Handling

- Tier 0: errors → skip to Tier 1 (pattern errors are config bugs, not runtime)
- Tier 1: provider timeout/error → fall through to Tier 2 (fail open)
- Tier 3: webhook failure → log error, do not retry (fire-and-forget)
- Config: validation errors → throw at startup (fail fast)
