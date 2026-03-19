# Architecture

## 4-Tier Cost Hierarchy

Tickle-stick intercepts inbound messages and routes them through a sequential
pipeline. The first tier to return a definitive result short-circuits the rest.

```
Inbound Message
       │
  ┌────▼────┐
  │ Tier 0  │  Deterministic — regex, keywords, commands
  │  FREE   │  Latency: <10ms
  └────┬────┘
       │ no match
  ┌────▼────┐
  │ Tier 1  │  Cheap model triage — Haiku / nano / local
  │ ~$0.001 │  Latency: <2s → returns: deflect | escalate | human
  └────┬────┘
       │ "escalate"
  ┌────▼────┐
  │ Tier 2  │  Full agent loop — passthrough to host
  │ ~$0.15  │  No Tickle-Stick logic
  └────┬────┘
       │ "human" (from Tier 1)
  ┌────▼────┐
  │ Tier 3  │  Human escalation — email/Slack/webhook
  │  FREE   │  Routes to your team
  └─────────┘
```

## Module Map

| Module                             | Purpose                                                  |
| ---------------------------------- | -------------------------------------------------------- |
| `src/interceptor.ts`               | Pipeline orchestrator — sequences tiers, emits telemetry |
| `src/tiers/tier0-deterministic.ts` | Pattern matching: regex, keyword, command                |
| `src/tiers/tier1-triage.ts`        | Cheap model call, confidence check, decision parsing     |
| `src/tiers/tier2-passthrough.ts`   | No-op — signals host agent loop should proceed           |
| `src/tiers/tier3-human.ts`         | Dispatches to webhook, email, or Slack                   |
| `src/config/schema.ts`             | Zod schema for `tickle-stick.yaml`                       |
| `src/config/loader.ts`             | YAML loading, env var interpolation                      |
| `src/providers/anthropic.ts`       | Anthropic (Haiku) triage provider                        |
| `src/providers/openai.ts`          | OpenAI triage provider                                   |
| `src/telemetry/logger.ts`          | Structured tier decision logging                         |
| `src/telemetry/metrics.ts`         | Cost tracking and tier distribution                      |

## Error Handling

The pipeline never throws. Each tier failure falls through to the next:

- **Tier 0 error** → log warning, try Tier 1
- **Tier 1 error** → log warning, fall through to Tier 2 (passthrough)
- **Tier 3 error** → log error, return result with error metadata

Config validation errors throw at startup (fail fast).

## Provider Interface

Any model can be used for Tier 1 triage by implementing `TriageProvider`:

```typescript
interface TriageProvider {
  readonly name: string;
  triage(
    message: InboundMessage,
    systemPrompt: string,
  ): Promise<TriageDecision>;
}
```

See `src/providers/anthropic.ts` for a reference implementation.
