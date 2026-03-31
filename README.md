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

## The Solution: Stage-Based Pipelines

Run cheap scripts first. Classify with a cheap model. Only invoke expensive
reasoning when items actually need it. Apply side effects at each step.

```
Scheduled Task (cron trigger from host)
       │
  ┌────▼─────┐
  │  Script   │  Shell/Python — fetch raw data
  │   FREE    │  Output: WorkItem[] (JSON stdout)
  │   <50ms   │  Empty = pipeline stops here ($0)
  └────┬──────┘
       │ items found
  ┌────▼─────┐
  │  Model   │  Cheap model — classify items
  │  (cheap)  │  routine / urgent / needs-reasoning
  │  ~$0.001  │  Post-hook: apply labels immediately
  └────┬──────┘
       │ filtered items
  ┌────▼─────┐
  │  Model   │  Expensive model — host callback
  │(expensive)│  Reason, synthesize, draft responses
  │  ~$0.05+  │  Post-hook: create drafts, apply labels
  └────┬──────┘
       │
  ┌────▼─────┐
  │ Callback  │  Host-provided function
  │   FREE    │  Deliver, label, escalate — host decides
  └───────────┘
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
      stages:
        - name: gather
          type: script
          command: "python3"
          args: ["scripts/check-email.py"]
          timeout: 30000

        - name: classify
          type: model
          provider: cheap
          systemPrompt: |
            Classify this item as JSON:
            {"classification": "routine"|"urgent"|"needs-reasoning",
             "response": "one-line summary", "confidence": 0.0-1.0}
          confidenceThreshold: 0.7
          postHook:
            command: "python3"
            args: ["scripts/apply-labels.py"]

        - name: reason
          type: model
          provider: expensive
          prompt: |
            Here are items that need reasoning:
            {{items}}
            Synthesize a response.
          input: "classified:needs-reasoning,classified:urgent"

        - name: deliver
          type: callback
```

Use it:

```typescript
import { Pipeline, loadConfig } from "tickle-stick";
import type { TriageProvider } from "tickle-stick";

const config = loadConfig();
const pipelineConfig = config.tickleStick.pipelines["email-check"];

// Host provides a TriageProvider for cheap model stages
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
  stageCallbacks: {
    reason: async (items, prompt) => {
      // Call your expensive model here
      return await callYourReasoningModel(prompt);
    },
    deliver: async (items) => {
      // Send to Slack, WhatsApp, etc.
      await sendToChannel(items.map((i) => i.summary).join("\n"));
      return "";
    },
  },
});

const result = await pipeline.run();
console.log(
  `Items: ${result.totalItems}, Cost: $${result.costEstimate.toFixed(4)}`,
);
```

## Script Stages

Script stages are shell commands that output JSON `WorkItem[]` to stdout:

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

If the script outputs `[]` or fails, the pipeline stops at the first stage with $0 cost.

## Provider Injection

Tickle-stick does **not** manage model providers. The host passes in a
`TriageProvider` implementation for cheap model stages:

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

## Post-Hooks

Any stage can have a `postHook` — a script that runs after the stage completes.
The stage output is piped to stdin as JSON. Use post-hooks for side effects:

```yaml
- name: classify
  type: model
  provider: cheap
  systemPrompt: "..."
  postHook:
    command: "python3"
    args: ["scripts/apply-spam-labels.py"]
    timeout: 15000
```

Post-hook errors are logged but don't fail the pipeline.

## Input Filters

Control which items a stage sees with the `input` field:

- `all` — everything from all previous stages
- `classified:needs-reasoning` — only items classified as needs-reasoning
- `classified:urgent,classified:needs-reasoning` — comma-separated union
- _(omitted)_ — all items from previous stages

## Budget & Alerts

Cap cheap model spend and get notified when thresholds are crossed:

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

When a budget cap is reached, cheap model stages are skipped — all items pass
through to downstream stages.

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
  stageCallbacks: { reason: reasoningCallback },
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

Tickle-stick works with any host that provides stage callbacks:

| Host     | Expensive Model Stage        | Callback Stage              |
| -------- | ---------------------------- | --------------------------- |
| NanoClaw | Direct API call or container | Sends to channel (WA/Slack) |
| OpenClaw | Calls model API directly     | Queues to delivery system   |
| Custom   | Your reasoning logic         | Your delivery logic         |

## License

MIT — see [LICENSE](LICENSE).

---

Built by [Kromatic](https://kromatic.com). We help teams build better products
through innovation accounting and experimentation.
