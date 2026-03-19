# 🦞 Tickle-Stick

**Opinionated cost-hierarchy extension for agentic workflows.**

> Named after the diving tool used to gently probe before committing.

![Tickle-Stick Hero](assets/hero.png)

---

## The Problem

You're running your agents wrong.

Every inbound message — "hi", "unsubscribe", "what's your status?" — triggers
a full agent loop at **~$0.15 per invocation**. That's $216/month just for
email checks. Most of those messages don't need intelligence.

## The Solution: 4-Tier Cost Hierarchy

Triage cheaply before committing expensive intelligence.

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
  │ ~$0.001 │  Latency: <2s
  └────┬────┘
       │ "escalate"
  ┌────▼────┐
  │ Tier 2  │  Full agent loop — your existing workflow
  │ ~$0.15  │  Passthrough, no Tickle-Stick logic
  └────┬────┘
       │ "human" (from Tier 1)
  ┌────▼────┐
  │ Tier 3  │  Human escalation — email/Slack/webhook
  │  FREE   │  Routes to your team
  └─────────┘
```

## Cost Comparison

| Scenario                             | Without Tickle-Stick | With Tickle-Stick | Savings |
| ------------------------------------ | -------------------- | ----------------- | ------- |
| 100 emails/day (60% simple)          | $15.00/day           | $2.10/day         | **86%** |
| 500 Slack messages/day (80% trivial) | $75.00/day           | $3.75/day         | **95%** |
| 1000 messages/day (mixed)            | $150.00/day          | $22.50/day        | **85%** |

## Quick Start

```bash
npm install tickle-stick
```

Create `tickle-stick.yaml`:

```yaml
tickleStick:
  tier0:
    patterns:
      - match: "^(hi|hello|hey)\\b"
        type: regex
        flags: "i"
        action: deflect
        response: "Hello! How can I help?"
      - match: "/help"
        type: command
        action: deflect
        response: "Here's what I can do..."
    keywords:
      - match: ["unsubscribe", "stop"]
        action: deflect
        response: "You've been unsubscribed."

  tier1:
    provider: anthropic
    model: claude-haiku-4-5-20251001
    systemPrompt: |
      Classify this message as JSON:
      {"action": "deflect"|"escalate"|"human", "response": "...", "confidence": 0.0-1.0}
    confidenceThreshold: 0.7

  tier3:
    routes:
      - channel: webhook
        url: "${ESCALATION_WEBHOOK_URL}"

  providers:
    anthropic:
      apiKey: "${ANTHROPIC_API_KEY}"
```

Use it:

```typescript
import { Interceptor, loadConfig } from "tickle-stick";

const config = loadConfig();
const interceptor = new Interceptor({ config });

// Process an inbound message
const result = await interceptor.process({
  id: "msg-001",
  channel: "email",
  from: "alice@example.com",
  subject: "Hello!",
  body: "Hi there!",
  timestamp: new Date(),
});

console.log(result);
// { tier: 0, action: "deflect", response: "Hello! How can I help?",
//   costEstimate: 0, latencyMs: 0.3 }
```

## Telemetry

Every message is logged with tier, action, latency, and cost:

```json
{
  "event": "tickle_stick.process",
  "messageId": "msg-001",
  "channel": "email",
  "tier": 0,
  "action": "deflect",
  "latencyMs": 0.3,
  "costEstimate": 0,
  "timestamp": "2026-03-19T10:00:00.000Z"
}
```

Track aggregate savings:

```typescript
const metrics = interceptor.getMetrics();
console.log(`Processed: ${metrics.totalProcessed}`);
console.log(`Total cost: $${metrics.totalCost.toFixed(2)}`);
console.log(`Saved: $${metrics.costSaved.toFixed(2)}`);
```

## Providers

Tickle-stick ships with two Tier 1 providers:

| Provider  | Model                     | Est. cost/call |
| --------- | ------------------------- | -------------- |
| Anthropic | claude-haiku-4-5-20251001 | ~$0.001        |
| OpenAI    | gpt-4.1-nano              | ~$0.001        |

Implement `TriageProvider` to add your own:

```typescript
import type { TriageProvider } from "tickle-stick";

const myProvider: TriageProvider = {
  name: "my-provider",
  async triage(message, systemPrompt) {
    // Your model call here
    return { action: "deflect", response: "...", confidence: 0.9 };
  },
};
```

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full module map
and error handling strategy.

## Configuration

See [docs/configuration.md](docs/configuration.md) for the complete YAML
schema reference.

## License

MIT — see [LICENSE](LICENSE).

---

Built by [Kromatic](https://kromatic.com). We help teams build better products
through innovation accounting and experimentation.
