# Tickle-Stick

**Cost-optimized task execution pipeline for agentic workflows.**

> Named after the diving tool used to gently probe before committing.

![Tickle-Stick Hero](assets/hero.png)

---

## The Problem

You're running your agents wrong.

Every scheduled task — email check, calendar sync, dependabot alerts — triggers
a full agent loop at **~$0.15 per invocation**. That's $216/month just for
email checks. Most of those tasks don't need intelligence.

## The Solution: 4-Tier Task Pipeline

Run cheap scripts first. Classify with a cheap model. Only invoke expensive
reasoning when items actually need it.

```
Scheduled Task (cron trigger from host)
       │
  ┌────▼────┐
  │ Tier 0  │  Scripts — shell/Python, run by library
  │  FREE   │  Fetch raw data → WorkItem[] (JSON stdout)
  │  <50ms  │  Empty output = pipeline stops here ($0)
  └────┬────┘
       │ items found
  ┌────▼────┐
  │ Tier 1  │  Cheap model — Haiku / nano / local
  │ ~$0.001 │  Classify: routine / urgent / needs-reasoning / human
  └────┬────┘
       │ items needing reasoning
  ┌────▼────┐
  │ Tier 2  │  Host callback — full agent / model
  │ ~$0.05+ │  Reason, synthesize, draft responses
  └────┬────┘
       │ items needing human
  ┌────▼────┐
  │ Tier 3  │  Host callback — human escalation
  │  FREE   │  Routes to Slack/WhatsApp/email
  └─────────┘
```

## Cost Comparison

| Scenario                       | Without Tickle-Stick | With Tickle-Stick | Savings |
| ------------------------------ | -------------------- | ----------------- | ------- |
| Daily email check (60% empty)  | $15.00/day           | $0.60/day         | **96%** |
| 5 cron tasks/day (80% no data) | $3.75/day            | $0.15/day         | **96%** |
| Weekly retro + daily briefing  | $1.80/week           | $0.30/week        | **83%** |

## Quick Start

```bash
npm install tickle-stick
```

Create `tickle-stick.yaml`:

```yaml
tickleStick:
  pipelines:
    email-check:
      tier0:
        command: "python3"
        args: ["scripts/check-email.py"]
        timeout: 30000
      tier1:
        systemPrompt: |
          Classify this item as JSON:
          {"classification": "routine"|"urgent"|"needs-reasoning"|"human",
           "response": "one-line summary", "confidence": 0.0-1.0}
        confidenceThreshold: 0.7
      tier2:
        prompt: |
          Here are items that need reasoning:
          {{items}}
          Synthesize a response.
      tier3:
        route: "main"
```

Use it:

```typescript
import { Pipeline, loadConfig } from "tickle-stick";
import type { TriageProvider } from "tickle-stick";

const config = loadConfig();
const pipelineConfig = config.tickleStick.pipelines["email-check"];

// Host provides a TriageProvider for Tier 1 classification
const myProvider: TriageProvider = {
  name: "haiku",
  async classify(text, systemPrompt) {
    const response = await callYourCheapModel(text, systemPrompt);
    return parseClassificationResponse(response);
  },
};

const pipeline = new Pipeline({
  name: "email-check",
  config: pipelineConfig,
  triageProvider: myProvider,
  onTier2: async (items, prompt) => {
    // Call your expensive model here
    return await callYourReasoningModel(prompt);
  },
  onTier3: async (items) => {
    // Send to Slack, WhatsApp, etc.
    await sendToChannel(items.map((i) => i.summary).join("\n"));
  },
});

const result = await pipeline.run();
console.log(
  `Items: ${result.tier0Items}, Cost: $${result.costEstimate.toFixed(4)}`,
);
```

## Tier 0 Scripts

Tier 0 scripts are shell commands that output JSON `WorkItem[]` to stdout:

```python
#!/usr/bin/env python3
import json, sys

items = [
    {
        "id": "email-001",
        "source": "gmail",
        "type": "email",
        "summary": "Meeting tomorrow at 10am",
        "body": "Full email body here...",
        "timestamp": "2026-03-25T10:00:00Z"
    }
]

json.dump(items, sys.stdout)
```

If the script outputs `[]` or fails, the pipeline stops at Tier 0 with $0 cost.

## Provider Injection

Tickle-stick does **not** manage model providers. The host passes in a
`TriageProvider` implementation:

```typescript
import type { TriageProvider } from "tickle-stick";
import { parseClassificationResponse } from "tickle-stick";

const myProvider: TriageProvider = {
  name: "my-provider",
  async classify(text, systemPrompt) {
    const raw = await callYourModel(text, systemPrompt);
    return parseClassificationResponse(raw);
  },
};
```

Or use the built-in `HttpTriageProvider` for OpenAI/Anthropic APIs:

```typescript
import { HttpTriageProvider } from "tickle-stick";

const provider = new HttpTriageProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4o-mini",
  provider: "openai",
});
```

## Budget & Alerts

Cap Tier 1 spend and get notified when thresholds are crossed:

```yaml
tickleStick:
  budget:
    maxDailySpend: 1.00
    maxWeeklySpend: 5.00
    alerts:
      - at: "80%"
      - at: 0.50
    retentionDays: 30
```

When a budget cap is reached, Tier 1 is skipped — all items go directly to
Tier 2 (host reasoning).

### Storage Adapter

Budget tracking requires a storage adapter to persist events:

```typescript
import type { StorageAdapter } from "tickle-stick";

const storage: StorageAdapter = {
  writeEvent(event) {
    db.run("INSERT INTO pipeline_events ...", event);
  },
  getSpendSince(since) {
    return db.get("SELECT SUM(cost_estimate) ...", since);
  },
  prune(before) {
    return db.run("DELETE FROM pipeline_events WHERE timestamp < ?", before);
  },
};
```

### Alert Sink

```typescript
import type { AlertSink } from "tickle-stick";

const alertSink: AlertSink = (alert) => {
  sendToMyChannel(`[Budget] ${alert.message}`);
};
```

### Wiring Budget

```typescript
const pipeline = new Pipeline({
  name: "email-check",
  config: pipelineConfig,
  triageProvider: myProvider,
  onTier2: reasoningCallback,
  storage,
  alertSink,
  budgetConfig: config.tickleStick.budget,
  timezone: "America/New_York",
});

await pipeline.pruneBudgetEvents();
```

### Budget Status API

```typescript
const status = await pipeline.getBudgetStatus();
if (status) {
  console.log(`Today: $${status.dailySpend.toFixed(2)}`);
  console.log(`This week: $${status.weeklySpend.toFixed(2)}`);
  console.log(`Exceeded: ${status.exceeded}`);
}
```

## Host Compatibility

Tickle-stick works with any host that provides two callbacks:

| Host     | Tier 2 (Reasoning)       | Tier 3 (Escalation)         |
| -------- | ------------------------ | --------------------------- |
| NanoClaw | Spawns agent container   | Sends to channel (WA/Slack) |
| OpenClaw | Calls model API directly | Queues to delivery system   |
| Custom   | Your reasoning logic     | Your escalation logic       |

## License

MIT — see [LICENSE](LICENSE).

---

Built by [Kromatic](https://kromatic.com). We help teams build better products
through innovation accounting and experimentation.
