# Architecture

## Stage-Based Pipeline

Tickle-stick executes work items through a configurable sequence of stages.
Each stage is one of three types: script, model, or callback.

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
  │  ~$0.001  │  Post-hook: apply labels, side effects
  └────┬──────┘
       │ filtered items
  ┌────▼─────┐
  │  Model   │  Expensive model — host callback
  │(expensive)│  Reason, synthesize, draft responses
  │  ~$0.05+  │  Post-hook: apply labels, create drafts
  └────┬──────┘
       │
  ┌────▼─────┐
  │ Callback  │  Host-provided function
  │   FREE    │  Deliver, label, escalate — host decides
  └───────────┘
```

Pipelines can have any number of stages in any order. The above is a common
pattern, not a fixed structure.

## Stage Types

| Type       | Execution                                                    |
| ---------- | ------------------------------------------------------------ |
| `script`   | Run a command, parse JSON stdout as WorkItem[]               |
| `model`    | `cheap`: classify each item via TriageProvider               |
|            | `expensive`: call host callback with items + prompt          |
| `callback` | Call host-provided function (delivery, labeling, escalation) |

## Item Flow

- Script stages produce `WorkItem[]` that accumulate in the pipeline context
- Model stages can access `{{items}}` (filtered input) and `{{all_items}}` (everything)
- The `input` filter controls what a stage sees: `all`, `classified:needs-reasoning`, etc.
- Post-hooks receive stage output on stdin as JSON (for side effects like labeling)

## Module Map

| Module                         | Purpose                                      |
| ------------------------------ | -------------------------------------------- |
| `src/pipeline.ts`              | Pipeline orchestrator — sequences stages     |
| `src/tiers/tier1-triage.ts`    | Cheap model classification, confidence check |
| `src/script-runner.ts`         | Script stage execution                       |
| `src/post-hook.ts`             | Post-hook execution (stdin piping)           |
| `src/config/schema.ts`         | Zod schema for `tickle-stick.yaml`           |
| `src/config/loader.ts`         | YAML loading, env var interpolation          |
| `src/providers/parse.ts`       | Classification response parser               |
| `src/telemetry/logger.ts`      | Structured pipeline event logging            |
| `src/telemetry/metrics.ts`     | Cost tracking and stage distribution         |
| `src/budget/budget-manager.ts` | Budget tracking, alerts, day/week boundaries |

## Error Handling

The pipeline never throws. Each stage failure is caught and logged:

- **Script error** → returns [], pipeline may early-exit if first stage
- **Model error** → item classified as "needs-reasoning" (escalates)
- **Callback error** → logged, pipeline continues
- **Post-hook error** → logged, does not fail the stage

Config validation errors throw at startup (fail fast).

## Provider Interface

Any model can be used for cheap classification by implementing `TriageProvider`:

```typescript
interface TriageProvider {
  readonly name: string;
  classify(text: string, systemPrompt: string): Promise<ClassificationResult>;
}
```

The host injects a `TriageProvider` when constructing the `Pipeline`.
