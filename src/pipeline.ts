import type {
  AlertSink,
  BudgetStatus,
  ClassifiedItem,
  PipelineResult,
  StageCallback,
  StageResult,
  StorageAdapter,
  TriageProvider,
  WorkItem,
} from "./types.js";
import type {
  PipelineConfigEntry,
  StageConfig,
  TelemetryConfig,
} from "./config/schema.js";
import { BudgetManager } from "./budget/budget-manager.js";
import { classifyItem } from "./tiers/tier1-triage.js";
import { runScript, runPipedScript } from "./script-runner.js";
import { runPostHook } from "./post-hook.js";
import {
  createLogger,
  type LogSink,
  type TelemetryEvent,
} from "./telemetry/logger.js";
import { MetricsCollector, type TierMetrics } from "./telemetry/metrics.js";

export interface PipelineOptions {
  /** Pipeline name (used in telemetry and results). */
  name: string;
  /** Pipeline configuration (stages array). */
  config: PipelineConfigEntry;
  /** Telemetry configuration. */
  telemetry?: TelemetryConfig;
  /** Provider for cheap model stages. */
  triageProvider?: TriageProvider;
  /** Callbacks for expensive model and callback stages, keyed by stage name. */
  stageCallbacks?: Record<string, StageCallback>;
  /** Called after each stage completes. */
  onStageComplete?: (name: string, result: StageResult) => void;
  /**
   * Called when a stage or post-hook throws. Errors are still swallowed
   * (the pipeline continues), but consumers can observe them for telemetry
   * or logging. `phase` distinguishes a stage body throw ("stage") from a
   * post-hook throw ("post-hook").
   */
  onError?: (stage: string, err: unknown, phase: "stage" | "post-hook") => void;
  /** Custom log sink. */
  logSink?: LogSink;
  /** Storage adapter for budget tracking. */
  storage?: StorageAdapter;
  /** Callback for budget alerts. */
  alertSink?: AlertSink;
  /** Budget configuration. If provided, enables budget tracking. */
  budgetConfig?: import("./config/schema.js").BudgetConfig;
  /** IANA timezone for budget day/week boundaries. Default: "UTC". */
  timezone?: string;
}

/** Accumulated state across pipeline stages. */
interface PipelineContext {
  /** All work items from script stages. */
  allItems: WorkItem[];
  /** All classified items from cheap model stages. */
  classified: ClassifiedItem[];
  /** Text outputs from expensive model and callback stages, keyed by stage name. */
  stageOutputs: Map<string, string>;
}

function applyInputFilter(
  filter: string | undefined,
  context: PipelineContext,
): (WorkItem | ClassifiedItem)[] {
  if (!filter || filter === "all") {
    // Return all items: classified items take precedence over raw items
    const classifiedIds = new Set(context.classified.map((c) => c.id));
    const unclassified = context.allItems.filter(
      (i) => !classifiedIds.has(i.id),
    );
    return [...unclassified, ...context.classified];
  }

  // Filter by classification: "classified:needs-reasoning,classified:urgent"
  const classifications = filter
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f.startsWith("classified:"))
    .map((f) => f.slice("classified:".length));

  if (classifications.length > 0) {
    return context.classified.filter((c) =>
      classifications.includes(c.classification),
    );
  }

  // Unknown filter — return all items
  return [...context.allItems, ...context.classified];
}

function interpolatePrompt(
  template: string,
  items: (WorkItem | ClassifiedItem)[],
  context: PipelineContext,
): string {
  const itemsJson = JSON.stringify(
    items.map((c) => ({
      id: c.id,
      source: c.source,
      type: c.type,
      summary: c.summary,
      body: c.body,
      metadata: c.metadata,
      ...("classification" in c
        ? { classification: c.classification, confidence: c.confidence }
        : {}),
    })),
    null,
    2,
  );

  const allItems = applyInputFilter("all", context);
  const allItemsJson = JSON.stringify(
    allItems.map((c) => ({
      id: c.id,
      source: c.source,
      type: c.type,
      summary: c.summary,
      body: c.body,
      metadata: c.metadata,
      ...("classification" in c
        ? { classification: c.classification, confidence: c.confidence }
        : {}),
    })),
    null,
    2,
  );

  return template
    .replace("{{items}}", itemsJson)
    .replace("{{all_items}}", allItemsJson);
}

export class Pipeline {
  private readonly name: string;
  private readonly config: PipelineConfigEntry;
  private readonly logger: LogSink | null;
  private readonly metrics: MetricsCollector;
  private readonly provider: TriageProvider | null;
  private readonly budgetManager: BudgetManager | null;
  private readonly stageCallbacks: Record<string, StageCallback>;
  private readonly onStageComplete: PipelineOptions["onStageComplete"];
  private readonly onError: PipelineOptions["onError"];

  constructor(options: PipelineOptions) {
    this.name = options.name;
    this.config = options.config;
    this.logger = createLogger(
      options.telemetry ?? { enabled: true, format: "json" },
      options.logSink,
    );
    this.metrics = new MetricsCollector();
    this.provider = options.triageProvider ?? null;
    this.stageCallbacks = options.stageCallbacks ?? {};
    this.onStageComplete = options.onStageComplete;
    this.onError = options.onError;

    this.budgetManager = options.budgetConfig
      ? new BudgetManager({
          config: options.budgetConfig,
          storage: options.storage,
          alertSink: options.alertSink,
          timezone: options.timezone,
        })
      : null;
  }

  async run(): Promise<PipelineResult> {
    const pipelineStart = performance.now();
    const context: PipelineContext = {
      allItems: [],
      classified: [],
      stageOutputs: new Map(),
    };
    const stageResults: StageResult[] = [];
    let totalCost = 0;

    for (const stage of this.config.stages) {
      const stageStart = performance.now();
      const stageResult: StageResult = {
        name: stage.name,
        type: stage.type,
        items: [],
        costEstimate: 0,
        latencyMs: 0,
      };

      try {
        switch (stage.type) {
          case "script":
            await this.runScriptStage(stage, context, stageResult);
            break;
          case "model":
            await this.runModelStage(stage, context, stageResult);
            break;
          case "callback":
            await this.runCallbackStage(stage, context, stageResult);
            break;
        }
      } catch (err) {
        // Stage errors don't fail the pipeline; surface to onError observers
        this.onError?.(stage.name, err, "stage");
      }

      stageResult.latencyMs = performance.now() - stageStart;
      totalCost += stageResult.costEstimate;
      stageResults.push(stageResult);

      this.emit({
        pipeline: this.name,
        tier: stageResults.length - 1,
        action:
          stage.type === "script"
            ? context.allItems.length > 0
              ? "found"
              : "empty"
            : stage.name,
        latencyMs: stageResult.latencyMs,
        costEstimate: stageResult.costEstimate,
      });

      // Run post-hook if configured
      if (stage.postHook) {
        try {
          const hookInput = stageResult.output
            ? stageResult.output
            : JSON.stringify(stageResult.items);
          await runPostHook(
            stage.postHook.command,
            stage.postHook.args,
            hookInput,
            stage.postHook.timeout,
          );
        } catch (err) {
          // Post-hook errors don't fail the pipeline; surface to onError observers
          this.onError?.(stage.name, err, "post-hook");
        }
      }

      this.onStageComplete?.(stage.name, stageResult);

      // Early exit if script stage returned no items and it's the first stage
      if (
        stage.type === "script" &&
        stageResults.length === 1 &&
        context.allItems.length === 0
      ) {
        break;
      }
    }

    return {
      pipeline: this.name,
      stageResults,
      totalItems: context.allItems.length,
      costEstimate: totalCost,
      latencyMs: performance.now() - pipelineStart,
    };
  }

  /**
   * Run a script stage.
   *
   * Two modes, determined by the presence of `stage.input`:
   *
   * 1. **Gather mode** (no input filter): script runs independently and
   *    produces new WorkItems. This is the standard Tier 0 data-collection
   *    pattern — the script fetches from external sources (Gmail, Calendar,
   *    GitHub, etc.) and outputs WorkItem[] JSON on stdout.
   *
   * 2. **Piped mode** (input filter set): filtered items from prior stages
   *    are serialized as JSON and piped to the script's stdin. The script
   *    transforms/enriches those items and outputs the result on stdout.
   *    This enables post-classification enrichment — e.g., once a cheap
   *    model (thalamus) flags items as worth reasoning about, a piped
   *    script can fetch full context (threads, sender history, calendar)
   *    before the expensive model runs. This avoids enriching items that
   *    were filtered out (spam, routine) and avoids burning expensive
   *    model tokens on data-fetching tool calls.
   *
   *    Piped scripts replace their input items in the context rather than
   *    appending, since they're transforming existing items, not producing
   *    new ones.
   */
  private async runScriptStage(
    stage: StageConfig,
    context: PipelineContext,
    result: StageResult,
  ): Promise<void> {
    if (!stage.command) return;

    if (stage.input) {
      // Piped mode: filter items, pipe to stdin, replace in context
      const inputItems = applyInputFilter(stage.input, context);
      if (inputItems.length === 0) return;

      const stdinData = JSON.stringify(
        inputItems.map((item) => ({
          id: item.id,
          source: item.source,
          type: item.type,
          summary: item.summary,
          body: item.body,
          metadata: item.metadata,
          ...("classification" in item
            ? {
                classification: item.classification,
                confidence: item.confidence,
              }
            : {}),
        })),
      );

      const enriched = await runPipedScript(
        stage.command,
        stage.args,
        stage.timeout,
        stdinData,
        stage.cwd,
      );

      if (enriched.length > 0) {
        // Replace input items with enriched versions in context
        const enrichedIds = new Set(enriched.map((e) => e.id));
        context.allItems = context.allItems.filter(
          (i) => !enrichedIds.has(i.id),
        );
        context.allItems.push(...enriched);

        // Also update classified items if they were enriched
        const enrichedMap = new Map(enriched.map((e) => [e.id, e]));
        context.classified = context.classified.map((c) => {
          const updated = enrichedMap.get(c.id);
          if (updated) {
            return {
              ...c,
              ...updated,
              classification: c.classification,
              confidence: c.confidence,
            };
          }
          return c;
        });
      }

      result.items = enriched;
    } else {
      // Gather mode: script runs independently, produces new items
      const items = await runScript(
        stage.command,
        stage.args,
        stage.timeout,
        stage.cwd,
      );
      context.allItems.push(...items);
      result.items = items;
    }
  }

  private async runModelStage(
    stage: StageConfig,
    context: PipelineContext,
    result: StageResult,
  ): Promise<void> {
    const inputItems = applyInputFilter(stage.input, context);

    if (inputItems.length === 0) return;

    if (stage.provider === "cheap") {
      await this.runCheapModel(stage, inputItems, context, result);
    } else {
      await this.runExpensiveModel(stage, inputItems, context, result);
    }
  }

  private async runCheapModel(
    stage: StageConfig,
    inputItems: (WorkItem | ClassifiedItem)[],
    context: PipelineContext,
    result: StageResult,
  ): Promise<void> {
    const budgetOk = !this.budgetManager?.isBudgetExceeded();
    if (!this.provider || !budgetOk || !stage.systemPrompt) return;

    const classified: ClassifiedItem[] = [];
    for (const item of inputItems) {
      try {
        const {
          classified: ci,
          costEstimate,
          latencyMs,
        } = await classifyItem(item, stage, this.provider);
        classified.push(ci);
        result.costEstimate += costEstimate;

        this.emit({
          pipeline: this.name,
          itemId: ci.id,
          source: ci.source,
          tier: 1,
          action: ci.classification,
          latencyMs,
          costEstimate,
          confidence: ci.confidence,
        });
      } catch {
        // Classification failed → escalate to needs-reasoning
        classified.push({
          ...item,
          classification: "needs-reasoning",
          confidence: 0,
        });
      }
    }

    context.classified.push(...classified);
    result.items = classified;
  }

  private async runExpensiveModel(
    stage: StageConfig,
    inputItems: (WorkItem | ClassifiedItem)[],
    context: PipelineContext,
    result: StageResult,
  ): Promise<void> {
    const callback = this.stageCallbacks[stage.name];
    if (!callback || !stage.prompt) return;

    const prompt = interpolatePrompt(stage.prompt, inputItems, context);
    const output = await callback(inputItems as ClassifiedItem[], prompt);
    context.stageOutputs.set(stage.name, output);
    result.output = output;
    result.items = inputItems as ClassifiedItem[];
  }

  private async runCallbackStage(
    stage: StageConfig,
    context: PipelineContext,
    result: StageResult,
  ): Promise<void> {
    const callback = this.stageCallbacks[stage.name];
    if (!callback) return;

    const inputItems = applyInputFilter(stage.input, context);
    const output = await callback(inputItems as ClassifiedItem[], "");
    context.stageOutputs.set(stage.name, output);
    result.output = output;
    result.items = inputItems as ClassifiedItem[];
  }

  private emit(partial: Omit<TelemetryEvent, "event" | "timestamp">): void {
    const event: TelemetryEvent = {
      event: "tickle_stick.pipeline",
      timestamp: new Date().toISOString(),
      ...partial,
    };
    this.metrics.record({
      tier: event.tier,
      costEstimate: event.costEstimate,
      latencyMs: event.latencyMs,
    });
    if (this.logger) {
      this.logger(event);
    }
    if (this.budgetManager && event.costEstimate > 0) {
      this.budgetManager.record(event).catch(() => {
        /* best-effort */
      });
    }
  }

  getMetrics(): TierMetrics {
    return this.metrics.getMetrics();
  }

  resetMetrics(): void {
    this.metrics.reset();
  }

  async pruneBudgetEvents(): Promise<number> {
    return this.budgetManager?.prune() ?? 0;
  }

  isBudgetExceeded(): boolean {
    return this.budgetManager?.isBudgetExceeded() ?? false;
  }

  async getBudgetStatus(): Promise<BudgetStatus | null> {
    return this.budgetManager?.getBudgetStatus() ?? null;
  }
}
