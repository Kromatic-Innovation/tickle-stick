import type {
  AlertSink,
  BudgetStatus,
  ExpensiveStageProvider,
  PipelineResult,
  StageCallback,
  StageResult,
  StorageAdapter,
  TriageProvider,
} from "./types.js";
import type { PipelineConfigEntry, TelemetryConfig } from "./config/schema.js";
import { BudgetManager } from "./budget/budget-manager.js";
import { runPostHook } from "./post-hook.js";
import {
  createLogger,
  type LogSink,
  type TelemetryEvent,
} from "./telemetry/logger.js";
import { MetricsCollector, type TierMetrics } from "./telemetry/metrics.js";
import type { PipelineContext } from "./pipeline/context.js";
import { StageRouter } from "./pipeline/stage-router.js";

export interface PipelineOptions {
  /** Pipeline name (used in telemetry and results). */
  name: string;
  /** Pipeline configuration (stages array). */
  config: PipelineConfigEntry;
  /** Telemetry configuration. */
  telemetry?: TelemetryConfig;
  /** Provider for cheap-model stages. */
  triageProvider?: TriageProvider;
  /**
   * Provider for expensive-model and callback stages. Symmetric with
   * {@link triageProvider}; structurally a `Record<string, StageCallback>`
   * keyed by stage name.
   */
  expensiveStageProvider?: ExpensiveStageProvider;
  /**
   * @deprecated Use {@link expensiveStageProvider}. Kept for 0.4.x
   * compatibility; will be removed in 1.0.
   */
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

/**
 * Pipeline orchestrator. Owns the stage loop, telemetry emission,
 * budget tracking, post-hook invocation, and lifecycle callbacks.
 * Per-stage execution lives in {@link StageRouter}.
 */
export class Pipeline {
  private readonly name: string;
  private readonly config: PipelineConfigEntry;
  private readonly logger: LogSink | null;
  private readonly metrics: MetricsCollector;
  private readonly budgetManager: BudgetManager | null;
  private readonly router: StageRouter;
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

    this.router = new StageRouter({
      pipelineName: this.name,
      provider: options.triageProvider ?? null,
      stageCallbacks:
        options.expensiveStageProvider ?? options.stageCallbacks ?? {},
      budgetManager: this.budgetManager,
      emit: (partial) => this.emit(partial),
      onError: this.onError,
    });
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
        await this.router.runStage(stage, context, stageResult);
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
            ? stageResult.errored
              ? "error"
              : context.allItems.length > 0
                ? "found"
                : "empty"
            : stage.name,
        latencyMs: stageResult.latencyMs,
        costEstimate: stageResult.costEstimate,
      });

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
