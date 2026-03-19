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

## Host injection

Tickle-stick does not ship concrete providers. The host agent injects a
`TriageProvider` implementation when constructing the `Interceptor`:

```typescript
import { Interceptor, parseTriageResponse } from "tickle-stick";
import type { TriageProvider } from "tickle-stick";

const provider: TriageProvider = {
  name: "host-model",
  async triage(message, systemPrompt) {
    const text = await hostModelCall(message, systemPrompt);
    return parseTriageResponse(text);
  },
};

const interceptor = new Interceptor({ config, triageProvider: provider });
```

Use `parseTriageResponse` to extract a `TriageDecision` from raw model
output (handles plain JSON and markdown-wrapped code blocks).
