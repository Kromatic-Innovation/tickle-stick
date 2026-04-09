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
pattern, not a fixed structure. A richer pattern includes a piped script stage
for enrichment (see below).

## Stage Types

| Type       | Execution                                                    |
| ---------- | ------------------------------------------------------------ |
| `script`   | Run a command, parse JSON stdout as WorkItem[]               |
| `model`    | `cheap`: classify each item via TriageProvider               |
|            | `expensive`: call host callback with items + prompt          |
| `callback` | Call host-provided function (delivery, labeling, escalation) |

### Script Stage Modes

Script stages operate in two modes, determined by the `input` field:

**Gather mode** (no `input` filter): The script runs independently, fetches
data from external sources, and outputs `WorkItem[]` on stdout. This is the
standard Tier 0 data-collection pattern.

**Piped mode** (`input` filter set): Filtered items from prior stages are
serialized as JSON and piped to the script's stdin. The script
transforms/enriches those items and outputs the result on stdout. Enriched
items replace their originals in the pipeline context.

## Enrichment Pattern (Piped Script Stages)

The piped script mode was designed for **post-classification enrichment** — a
pattern inspired by how the brain's thalamus and cortex interact:

1. A cheap classifier (thalamus) filters signal from noise
2. A piped script stage (spreading activation) fetches full context only for
   items worth reasoning about
3. The expensive model (cortex) reasons immediately with rich, pre-loaded context

This avoids two inefficiencies:

- **Pre-classification enrichment**: Enriching every item (including spam) wastes
  API calls and time on items that will be filtered out.
- **Model-driven data fetching**: Having the expensive model use tool calls to
  fetch context burns tokens on data retrieval instead of reasoning.

```
  ┌────────────┐
  │   Script    │  Gather: fetch raw items (lightweight)
  │   (gather)  │  Output: WorkItem[] with minimal metadata
  └─────┬──────┘
        │
  ┌─────▼──────┐
  │   Model     │  Thalamus: cheap classification
  │   (cheap)   │  Filter: urgent / routine / spam / needs-reasoning
  └─────┬──────┘
        │ classified:urgent + classified:needs-reasoning
  ┌─────▼──────┐
  │   Script    │  Spreading activation: piped enrichment
  │   (piped)   │  stdin: filtered items → fetch thread, history, calendar
  │             │  stdout: enriched items with full context in metadata
  └─────┬──────┘
        │
  ┌─────▼──────┐
  │   Model     │  Cortex: reason with full pre-loaded context
  │ (expensive) │  No tool calls needed — everything is in the items
  └─────────────┘
```

## Item Flow

- Script stages in gather mode produce `WorkItem[]` that accumulate in the pipeline context
- Script stages in piped mode replace their input items with enriched versions
- Model stages can access `{{items}}` (filtered input) and `{{all_items}}` (everything)
- The `input` filter controls what a stage sees: `all`, `classified:needs-reasoning`, etc.
- Post-hooks receive stage output on stdin as JSON (for side effects like labeling)

## Module Map

| Module                         | Purpose                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `src/pipeline.ts`              | Pipeline orchestrator — sequences stages                      |
| `src/tiers/tier1-triage.ts`    | Cheap model classification, confidence check                  |
| `src/script-runner.ts`         | Script execution: gather (execFile) and piped (spawn + stdin) |
| `src/post-hook.ts`             | Post-hook execution (stdin piping)                            |
| `src/config/schema.ts`         | Zod schema for `tickle-stick.yaml`                            |
| `src/config/loader.ts`         | YAML loading, env var interpolation                           |
| `src/providers/parse.ts`       | Classification response parser                                |
| `src/telemetry/logger.ts`      | Structured pipeline event logging                             |
| `src/telemetry/metrics.ts`     | Cost tracking and stage distribution                          |
| `src/budget/budget-manager.ts` | Budget tracking, alerts, day/week boundaries                  |

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
