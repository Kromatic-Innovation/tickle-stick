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
}

/**
 * Stage execution dispatcher. Owns the per-stage logic for the three
 * stage types (script / model / callback). The {@link Pipeline} class
 * owns orchestration (loop, telemetry, post-hooks, budget); StageRouter
 * owns the stage-body execution itself.
 *
 * Pulled out of `Pipeline` to keep that class focused on orchestration
 * concerns. See `pre-1.0` plan in #34 for the rationale.
 */
export class StageRouter {
  private readonly pipelineName: string;
  private readonly provider: TriageProvider | null;
  private readonly stageCallbacks: ExpensiveStageProvider;
  private readonly budgetManager: BudgetManager | null;
  private readonly emit: StageRouterOptions["emit"];

  constructor(options: StageRouterOptions) {
    this.pipelineName = options.pipelineName;
    this.provider = options.provider;
    this.stageCallbacks = options.stageCallbacks;
    this.budgetManager = options.budgetManager;
    this.emit = options.emit;
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
          pipeline: this.pipelineName,
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
}
