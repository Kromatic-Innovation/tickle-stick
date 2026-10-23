import type { StageConfig } from "../config/schema.js";
import type {
  ClassifiedItem,
  ExpensiveStageProvider,
  StageResult,
  TriageProvider,
  WorkItem,
} from "../types.js";
import type { TelemetryEvent } from "../telemetry/logger.js";
import type { BudgetManager } from "../budget/budget-manager.js";
import { classifyItem } from "../tiers/tier1-triage.js";
import { runScript, runPipedScript } from "../script-runner.js";
import { applyInputFilter, type PipelineContext } from "./context.js";
import { interpolatePrompt } from "./prompt-interpolator.js";

export interface StageRouterOptions {
  pipelineName: string;
  provider: TriageProvider | null;
  stageCallbacks: ExpensiveStageProvider;
  budgetManager: BudgetManager | null;
  emit: (partial: Omit<TelemetryEvent, "event" | "timestamp">) => void;
  /** Surfaced when a script stage's command fails (see StageResult.errored). */
  onError?: (
    stage: string,
    err: unknown,
    phase: "stage" | "post-hook",
  ) => void;
}

/**
 * Stage execution dispatcher. Owns the per-stage logic for the three
 * stage types (script / model / callback). The {@link Pipeline} class
 * owns orchestration (loop, telemetry, post-hooks, budget); StageRouter
 * owns the stage-body execution itself.
 *
 * Pulled out of `Pipeline` to keep that class focused on orchestration
 * concerns. See `pre-1.0` plan in tickle-stick#34 for the rationale.
 */
export class StageRouter {
  /**
   * Cadence (in items) for re-checking the budget cap against storage
   * inside the cheap-tier loop. Bounds a single stage's overshoot to this
   * many items instead of its whole item count, without hitting storage
   * once per item (tickle-stick#240).
   */
  private static readonly BUDGET_RECHECK_INTERVAL = 10;

  private readonly pipelineName: string;
  private readonly provider: TriageProvider | null;
  private readonly stageCallbacks: ExpensiveStageProvider;
  private readonly budgetManager: BudgetManager | null;
  private readonly emit: StageRouterOptions["emit"];
  private readonly onError: StageRouterOptions["onError"];

  constructor(options: StageRouterOptions) {
    this.pipelineName = options.pipelineName;
    this.provider = options.provider;
    this.stageCallbacks = options.stageCallbacks;
    this.budgetManager = options.budgetManager;
    this.emit = options.emit;
    this.onError = options.onError;
  }

  async runStage(
    stage: StageConfig,
    context: PipelineContext,
    result: StageResult,
  ): Promise<void> {
    switch (stage.type) {
      case "script":
        await this.runScriptStage(stage, context, result);
        return;
      case "model":
        await this.runModelStage(stage, context, result);
        return;
      case "callback":
        await this.runCallbackStage(stage, context, result);
        return;
    }
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
   *    model flags items as worth reasoning about, a piped script can
   *    fetch full context (threads, sender history, calendar) before the
   *    expensive model runs. This avoids enriching items that were filtered
   *    out (spam, routine) and avoids burning expensive model tokens on
   *    data-fetching tool calls.
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

    const reportError = (err: unknown): void => {
      result.errored = true;
      this.onError?.(stage.name, err, "stage");
    };

    if (stage.input) {
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
        reportError,
      );

      if (enriched.length > 0) {
        const enrichedIds = new Set(enriched.map((e) => e.id));
        context.allItems = context.allItems.filter(
          (i) => !enrichedIds.has(i.id),
        );
        context.allItems.push(...enriched);

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
      const items = await runScript(
        stage.command,
        stage.args,
        stage.timeout,
        stage.cwd,
        reportError,
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

    // Budget-exceeded is a RUNTIME skip (tickle-stick#241, operator ruling
    // D2) — distinct from the missing-provider/missing-systemPrompt case,
    // which is now a config error that fails fast at Pipeline construction
    // (see pipeline.ts). Every model stage, cheap or expensive, is skipped
    // while the cap is tripped. Skipped items are never written into
    // `context` here (they were already there, or weren't — this stage
    // simply doesn't touch it), so a downstream callback stage with
    // `input: "all"` still sees them.
    if (this.budgetManager?.isBudgetExceeded()) {
      this.skipModelStageForBudget(stage, result);
      return;
    }

    if (stage.provider === "cheap") {
      await this.runCheapModel(stage, inputItems, context, result);
    } else {
      await this.runExpensiveModel(stage, inputItems, context, result);
    }
  }

  /**
   * Skip an entire model stage because the budget cap is tripped. Emits a
   * telemetry event naming the budget as the skip reason and calls
   * `onError` once for the stage (tickle-stick#241, operator ruling D2,
   * AC1). This is a new, additive emit call — distinct from the per-item
   * emit inside {@link runCheapModel} — so it doesn't collide with that
   * event's shape.
   */
  private skipModelStageForBudget(
    stage: StageConfig,
    result: StageResult,
  ): void {
    result.errored = true;
    this.emit({
      pipeline: this.pipelineName,
      tier: stage.provider === "cheap" ? 1 : 2,
      action: "skipped",
      latencyMs: 0,
      costEstimate: 0,
      granularity: "stage",
      metadata: { reason: "budget", stage: stage.name },
    });
    this.onError?.(
      stage.name,
      new Error(`model stage "${stage.name}" skipped: budget cap exceeded`),
      "stage",
    );
  }

  private async runCheapModel(
    stage: StageConfig,
    inputItems: (WorkItem | ClassifiedItem)[],
    context: PipelineContext,
    result: StageResult,
  ): Promise<void> {
    // Defensive only: Pipeline's constructor validates that every
    // provider: "cheap" model stage has both a systemPrompt and a
    // triageProvider before the stage loop ever runs (tickle-stick#241).
    // This guard exists purely to satisfy the nullable `this.provider`
    // type for a StageRouter constructed directly, bypassing Pipeline.
    if (!this.provider || !stage.systemPrompt) return;

    const classified: ClassifiedItem[] = [];
    for (let i = 0; i < inputItems.length; i++) {
      // Per-item (cached, cheap) cap re-check: stop as soon as a prior
      // iteration's costed event tripped the cap, instead of running the
      // whole remaining batch at the stage's whole item count
      // (tickle-stick#240, AC3).
      if (this.budgetManager?.isBudgetExceeded()) break;

      // On a bounded cadence, refresh the cached flag against storage so
      // a cap trip that hasn't produced a costed event yet (e.g. another
      // stage or process spent the budget) is still caught within this
      // loop, without a storage hit on every single item.
      if (
        this.budgetManager &&
        i > 0 &&
        i % StageRouter.BUDGET_RECHECK_INTERVAL === 0
      ) {
        await this.budgetManager.refresh();
        if (this.budgetManager.isBudgetExceeded()) break;
      }

      const item = inputItems[i];
      try {
        const {
          classified: ci,
          costEstimate,
          latencyMs,
          tokensIn,
          tokensOut,
          provider,
          model,
          failureReason,
          costBasis,
        } = await classifyItem(item, stage, this.provider);
        classified.push(ci);
        result.costEstimate += costEstimate;

        // The provider degraded to the needs-reasoning sentinel because the
        // underlying call failed (not a genuine low-confidence result) —
        // surface it the same way a script-stage failure is surfaced
        // (tickle-stick#239). This is additive beside the existing
        // catch(err) below, which deliberately does NOT set result.errored.
        if (failureReason) {
          result.errored = true;
          this.onError?.(stage.name, new Error(failureReason), "stage");
        }

        // The sole cost-bearing event per classified item (granularity
        // "call"). The stage-aggregate event emitted once per stage in
        // Pipeline.run() is cost-free so storage/metrics see each dollar
        // exactly once (tickle-stick#254).
        this.emit({
          pipeline: this.pipelineName,
          itemId: ci.id,
          source: ci.source,
          tier: 1,
          action: ci.classification,
          latencyMs,
          costEstimate,
          confidence: ci.confidence,
          granularity: "call",
          callSite: stage.name,
          provider,
          model,
          tokensIn,
          tokensOut,
          costBasis,
          ...(costBasis === "estimated"
            ? { metadata: { reason: "default-cost-estimate" } }
            : {}),
        });
      } catch (err) {
        // Classification failed → escalate to needs-reasoning.
        // Surface the otherwise-swallowed error via onError so a dead LLM tier
        // is diagnosable (tickle-stick#84); the fallback below is unchanged. We deliberately
        // do NOT set result.errored here — this is pure observability and must
        // not alter output.errors surfacing that downstream consumers key off.
        this.onError?.(stage.name, err, "stage");
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
}
