# Tickle-Stick

**Cost-hierarchy pipeline for agentic workflows.**

> Named after the diving tool used to gently probe before committing.

![Tickle-Stick Hero](https://raw.githubusercontent.com/Kromatic-Innovation/tickle-stick/main/assets/hero.png)

---

## The Problem

You're running your agents wrong.

Every scheduled task — email check, calendar sync, dependabot alerts — triggers
a full agent loop at **~$0.15 per invocation**. A mailbox polled every ~15
minutes is ~100 runs/day — about $15/day, or **$450/month**, just for email
checks. Most of those tasks don't need intelligence.

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

## Requirements

- **Node.js ≥ 20** (declared in `engines`).
- **ESM-only.** Consumers must import, not `require()`.
- **TypeScript consumers** must use `"moduleResolution": "bundler"` or
  `"node16"` (or newer) in `tsconfig.json`. The library ships `.js`-suffixed
  import specifiers per Node16 convention.

## Quick Start

Install:

```bash
npm install tickle-stick
```

This end-to-end example runs with **no external services** — it uses an
inline fake triage provider and an echo shell command. Paste into
`quickstart.mjs`, then `node quickstart.mjs`.

```javascript
import { Pipeline } from "tickle-stick";

// A fake "cheap model" — classifies everything as needs-reasoning.
// Replace with HttpTriageProvider (see below) for real OpenAI/Anthropic.
const triageProvider = {
  name: "fake-triage",
  async classify(text) {
    return {
      classification: "needs-reasoning",
      response: `stub for: ${text.slice(0, 40)}`,
      confidence: 0.9,
    };
  },
};

const pipeline = new Pipeline({
  name: "demo",
  config: {
    stages: [
      {
        name: "gather",
        type: "script",
        command: "echo",
        args: [
          '[{"id":"demo-1","source":"chat","type":"message","summary":"Hello world","timestamp":"2026-04-22T10:00:00Z"}]',
        ],
        timeout: 5000,
      },
      {
        name: "classify",
        type: "model",
        provider: "cheap",
        systemPrompt: "Classify the item.",
        confidenceThreshold: 0.7,
      },
      {
        name: "reason",
        type: "model",
        provider: "expensive",
        prompt: "Synthesize a response for: {{items}}",
        input: "classified:needs-reasoning",
      },
      { name: "deliver", type: "callback" },
    ],
  },
  triageProvider,
  expensiveStageProvider: {
    reason: async (items) => `reasoned ${items.length} item(s)`,
    deliver: async (items) => {
      console.log("delivered:", items.map((i) => i.summary).join(", "));
      return "";
    },
  },
});

const result = await pipeline.run();
console.log(
  `items=${result.totalItems} cost=$${result.costEstimate.toFixed(4)}`,
);
```

Expected output (with telemetry logs elided):

```
delivered: Hello world
items=1 cost=$0.0010
```

> Telemetry is on by default, so a plain `node quickstart.mjs` also prints
> structured JSON to stdout — one line per stage plus one line per classified
> item — interleaved with the two lines above. Pass
> `telemetry: { enabled: false }` to the `Pipeline` (or a custom `logSink`) to
> silence or redirect it.

That's the full loop: script stage produces one item, the fake triage
provider classifies it, the `reason` stage runs the callback, and the
`deliver` callback prints the summary.

## YAML Configuration

For production use, move the stage definitions into a YAML file and load
them with `loadConfig()`:

```yaml
# tickle-stick.yaml
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

```typescript
import { Pipeline, loadConfig } from "tickle-stick";

const config = loadConfig(); // reads ./tickle-stick.yaml or ./config/tickle-stick.yaml
const pipelineConfig = config.tickleStick.pipelines["email-check"];

const pipeline = new Pipeline({
  name: "email-check",
  config: pipelineConfig,
  triageProvider,
  expensiveStageProvider: {
    reason: async (items, prompt) => callYourReasoningModel(prompt),
    deliver: async (items) => {
      await sendToChannel(items.map((i) => i.summary).join("\n"));
      return "";
    },
  },
});

const result = await pipeline.run();
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

## Cheap vs. expensive stages

The two kinds of `type: model` stage wire to different host-supplied mechanisms:

- `provider: cheap` — uses the `triageProvider` option passed to `Pipeline`.
  The provider returns a structured `{classification, response, confidence}`
  triple. Single wiring point for every cheap-model stage.
- `provider: expensive` — uses `expensiveStageProvider[stageName]`. The
  callback receives filtered items and the rendered prompt; it returns a
  string. Keyed by stage name so you can wire multiple expensive stages
  independently. (The legacy option name `stageCallbacks` is still honored
  as a deprecated alias and will be removed in 1.0.)

The asymmetry is deliberate: cheap stages share a classifier contract; expensive
stages are free-form per-stage reasoning calls.

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

## Error handling & observability

Stage and post-hook failures never abort the pipeline — a throw is caught, the
run continues, and the error is surfaced to the optional `onError` callback so
hosts can log or emit telemetry instead of losing it silently.

```typescript
const pipeline = new Pipeline({
  name: "triage",
  config,
  triageProvider,
  onError: (stage, err, phase) => {
    // phase: "stage" (a stage body threw) | "post-hook" (a postHook threw)
    console.error(`stage "${stage}" failed during ${phase}:`, err);
  },
});
```

`onError(stage, err, phase)` fires on:

- **Script-stage failures** — a script stage times out, exits non-zero,
  spawn-errors, or returns non-`WorkItem[]` output (`phase: "stage"`).
- **Post-hook failures** — a stage's `postHook` throws (`phase: "post-hook"`).
- **Cheap-model triage failures** _(since 0.6.0, [#84](https://github.com/Kromatic-Innovation/tickle-stick/issues/84))_ —
  a throw from the triage stage's `classify()` was previously swallowed by a
  bare `catch`; it now fires `onError` with `phase: "stage"` so a dead
  cheap-model tier is diagnosable. The item still falls back to
  `needs-reasoning` and the pipeline is otherwise unaffected.

### Inspecting failures after a run

For **script stages**, `StageResult.errored` is set to `true`, letting you
tell a failed gather apart from a legitimately empty one (both yield zero
items):

```typescript
const result = await pipeline.run();
for (const stage of result.stageResults) {
  if (stage.errored) console.warn(`stage "${stage.name}" failed`);
}
```

The cheap-model triage case above is **pure observability**: it fires
`onError` but deliberately does _not_ set `errored`, so consumers that key off
`errored` see unchanged behaviour. Observe those failures through the
`onError` callback rather than `stageResults`.

## Input Filters

Control which items a stage sees with the `input` field:

- `all` — everything from all previous stages
- `classified:needs-reasoning` — only items classified as needs-reasoning
- `classified:urgent,classified:needs-reasoning` — comma-separated union
- _(omitted)_ — all items from previous stages

The `classified:*` label values must match the `classification` field
returned by your `TriageProvider`.

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
  expensiveStageProvider: { reason: reasoningCallback },
  storage,
  alertSink,
  budgetConfig: config.tickleStick.budget,
  timezone: "America/New_York",
});

// Retention enforcement is automatic — the BudgetManager prunes
// events older than `retentionDays` on the first budget check of a
// process and on each subsequent day rollover. The call below is an
// escape hatch for hosts that want to prune on demand (e.g. tests,
// migrations).
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

## Public-beta notice (0.6.x)

Tickle-stick 0.6.x is a **public beta**. The core pipeline contract
(`Pipeline`, `TriageProvider`, `StorageAdapter`, YAML schema) is stable,
but a handful of internal-plumbing exports and config edge cases are still
being narrowed before 1.0. Under pre-1.0 SemVer, treat any `0.x` bump as
potentially breaking — see the [CHANGELOG](CHANGELOG.md) before upgrading.
The [1.0 tracking issue](https://github.com/Kromatic-Innovation/tickle-stick/issues/34)
has the full yellow-flag list.

## License

MIT — see [LICENSE](LICENSE).

---

Built by [Kromatic](https://kromatic.com). We help teams build better products
through innovation accounting and experimentation.
# scratch leak-test: /Users/exampleuser/leak-test-scratch.txt (tickle-stick#130 scratch commit, to be removed)
