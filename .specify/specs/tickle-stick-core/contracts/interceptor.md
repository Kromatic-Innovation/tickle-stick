# Pipeline Contract

## Purpose

The Pipeline orchestrates sequential execution of configurable stages.
It is the single entry point for processing work items through the cost hierarchy.

## Interface

```typescript
interface PipelineOptions {
  name: string;
  config: PipelineConfigEntry; // { stages: StageConfig[] }
  telemetry?: TelemetryConfig;
  triageProvider?: TriageProvider; // for cheap model stages
  stageCallbacks?: Record<string, StageCallback>; // for expensive + callback stages
  onStageComplete?: (name: string, result: StageResult) => void;
  logSink?: LogSink;
  storage?: StorageAdapter;
  alertSink?: AlertSink;
  budgetConfig?: BudgetConfig;
  timezone?: string;
}

interface Pipeline {
  run(): Promise<PipelineResult>;
}
```

## Behavior

1. Iterate through `config.stages` in order
2. For each stage, resolve input items via `input` filter
3. Execute based on `type`:
   - `script` → run command, parse JSON stdout as WorkItem[]
   - `model` + `cheap` → classify each item via TriageProvider
   - `model` + `expensive` → call stageCallbacks[name] with items + interpolated prompt
   - `callback` → call stageCallbacks[name] with items
4. Run `postHook` if configured (stage output piped via stdin)
5. Emit telemetry event, record StageResult
6. Notify onStageComplete

## Error contract

- Script error → returns [], may early-exit if first stage
- Classification error → item escalated to "needs-reasoning"
- Stage callback error → caught, pipeline continues
- Post-hook error → logged, does not fail stage
- Never throw from `run()` — always return a `PipelineResult`

## Telemetry event

Every stage emits a structured log entry:

```json
{
  "event": "tickle_stick.pipeline",
  "pipeline": "daily-briefing",
  "tier": 0,
  "action": "found",
  "latencyMs": 45,
  "costEstimate": 0,
  "timestamp": "2026-03-30T..."
}
```
