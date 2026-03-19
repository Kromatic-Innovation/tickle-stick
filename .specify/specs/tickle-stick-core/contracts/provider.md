# TriageProvider Interface Contract

## Purpose

Abstracts the model layer for Tier 1 triage. Allows swapping between
Anthropic, OpenAI, Ollama, or any other LLM provider without changing
the interceptor logic.

## Interface

```typescript
interface TriageProvider {
  /** Provider name for logging/telemetry */
  readonly name: string;

  /**
   * Send a message to the model for triage classification.
   * @param message - The inbound message to classify
   * @param systemPrompt - The classification prompt from config
   * @returns Classification decision
   */
  triage(
    message: InboundMessage,
    systemPrompt: string,
  ): Promise<TriageDecision>;
}

interface TriageDecision {
  /** The triage action: deflect locally, escalate to full agent, or route to human */
  action: "deflect" | "escalate" | "human";
  /** For deflect: the response to send back */
  response?: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Token usage for cost estimation */
  tokenUsage?: { input: number; output: number };
}
```

## Implementation requirements

1. **Parse model output** — The provider must parse the model's response
   into a `TriageDecision`. If parsing fails, return `{ action: "escalate",
confidence: 0 }` (fail open).

2. **Timeout** — Providers must respect the `timeout` config value.
   On timeout, throw a descriptive error (the interceptor handles fallback).

3. **Cost estimation** — If the model returns token counts, populate
   `tokenUsage`. The telemetry layer uses this for cost tracking.

4. **No side effects** — Providers must not send responses, modify state,
   or call external services beyond the model API.

## Shipped providers

| Provider    | Model                     | Cost/call (est.) |
| ----------- | ------------------------- | ---------------- |
| `anthropic` | claude-haiku-4-5-20251001 | ~$0.001          |
| `openai`    | gpt-4.1-nano              | ~$0.001          |

## Provider registration

Providers are registered by name in config and instantiated by the
interceptor at startup:

```yaml
tier1:
  provider: anthropic # Must match a key in providers.*
  model: claude-haiku-4-5-20251001

providers:
  anthropic:
    apiKey: "${ANTHROPIC_API_KEY}"
```
