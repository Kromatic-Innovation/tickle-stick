import type {
  AlertSink,
  BudgetStatus,
  ClassifiedItem,
  PipelineResult,
  StorageAdapter,
  TriageProvider,
  WorkItem,
} from "./types.js";
import type { PipelineConfigEntry, TelemetryConfig } from "./config/schema.js";
import { BudgetManager } from "./budget/budget-manager.js";
import { classifyItem } from "./tiers/tier1-triage.js";
import { runScript } from "./script-runner.js";
import {
  createLogger,
  type LogSink,
  type TelemetryEvent,
} from "./telemetry/logger.js";
import { MetricsCollector, type TierMetrics } from "./telemetry/metrics.js";

export interface PipelineOptions {
  /** Pipeline name (used in telemetry and results). */
  name: string;
  /** Pipeline configuration (tier0, tier1, tier2, tier3). */
  config: PipelineConfigEntry;
  /** Telemetry configuration. */
  telemetry?: TelemetryConfig;
  /** Provider for Tier 1 classification. */
  triageProvider?: TriageProvider;
  /** Callback for Tier 2 reasoning. Host provides implementation. */
  onTier2?: (items: ClassifiedItem[], prompt: string) => Promise<string>;
  /** Callback for Tier 3 human escalation. Host provides implementation. */
  onTier3?: (items: ClassifiedItem[]) => Promise<void>;
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

export class Pipeline {
  private readonly name: string;
  private readonly config: PipelineConfigEntry;
  private readonly logger: LogSink | null;
  private readonly metrics: MetricsCollector;
  private readonly provider: TriageProvider | null;
  private readonly budgetManager: BudgetManager | null;
  private readonly onTier2: PipelineOptions["onTier2"];
  private readonly onTier3: PipelineOptions["onTier3"];

  constructor(options: PipelineOptions) {
    this.name = options.name;
    this.config = options.config;
    this.logger = createLogger(
      options.telemetry ?? { enabled: true, format: "json" },
      options.logSink,
    );
    this.metrics = new MetricsCollector();
    this.provider = options.triageProvider ?? null;
    this.onTier2 = options.onTier2;
    this.onTier3 = options.onTier3;

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
    const start = performance.now();
    const result: PipelineResult = {
      pipeline: this.name,
      tier0Items: 0,
      tier1Classified: 0,
      tier2Escalated: 0,
      tier3Human: 0,
      costEstimate: 0,
      latencyMs: 0,
    };

    // --- Tier 0: Run script (if configured) ---
    let items: WorkItem[];
    if (this.config.tier0) {
      items = await runScript(
        this.config.tier0.command,
        this.config.tier0.args,
        this.config.tier0.timeout,
        this.config.tier0.cwd,
      );
    } else {
      items = [];
    }
    result.tier0Items = items.length;

    this.emit({
      pipeline: this.name,
      tier: 0,
      action: items.length > 0 ? "found" : "empty",
      latencyMs: performance.now() - start,
      costEstimate: 0,
    });

    if (items.length === 0) {
      result.latencyMs = performance.now() - start;
      return result;
    }

    // --- Tier 1: Classify (if provider available and budget ok) ---
    let classified: ClassifiedItem[];
    const budgetOk = !this.budgetManager?.isBudgetExceeded();

    if (this.config.tier1 && this.provider && budgetOk) {
      classified = [];
      for (const item of items) {
        try {
          const {
            classified: ci,
            costEstimate,
            latencyMs,
          } = await classifyItem(item, this.config.tier1, this.provider);
          classified.push(ci);
          result.costEstimate += costEstimate;
          result.tier1Classified++;

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
          // Classification failed → escalate to reasoning
          classified.push({
            ...item,
            classification: "needs-reasoning",
            confidence: 0,
          });
        }
      }
    } else {
      // No Tier 1 → all items go to Tier 2
      classified = items.map((item) => ({
        ...item,
        classification: "needs-reasoning" as const,
        confidence: 0,
      }));
    }

    // Partition by classification
    const routine = classified.filter((c) => c.classification === "routine");
    const urgent = classified.filter((c) => c.classification === "urgent");
    const needsReasoning = classified.filter(
      (c) => c.classification === "needs-reasoning",
    );
    const human = classified.filter((c) => c.classification === "human");

    // Build routine report from Tier 1 responses
    if (routine.length > 0 || urgent.length > 0) {
      const summaries = [...routine, ...urgent]
        .filter((c) => c.tier1Response)
        .map((c) => `- [${c.source}] ${c.tier1Response}`);
      if (summaries.length > 0) {
        result.routineReport = summaries.join("\n");
      }
    }

    // --- Tier 2: Reasoning (if items need it and callback provided) ---
    const tier2Items = [...urgent, ...needsReasoning];
    if (tier2Items.length > 0 && this.onTier2 && this.config.tier2) {
      result.tier2Escalated = tier2Items.length;
      const itemsJson = JSON.stringify(
        tier2Items.map((c) => ({
          id: c.id,
          source: c.source,
          type: c.type,
          summary: c.summary,
          body: c.body,
          classification: c.classification,
        })),
        null,
        2,
      );
      const prompt = this.config.tier2.prompt.replace("{{items}}", itemsJson);

      try {
        result.reasoningReport = await this.onTier2(tier2Items, prompt);
      } catch {
        // Reasoning failed — items still logged
      }

      this.emit({
        pipeline: this.name,
        tier: 2,
        action: "reasoning",
        latencyMs: performance.now() - start,
        costEstimate: 0, // Host tracks container cost separately
      });
    }

    // --- Tier 3: Human escalation ---
    if (human.length > 0) {
      result.tier3Human = human.length;
      result.humanItems = human;

      if (this.onTier3) {
        try {
          await this.onTier3(human);
        } catch {
          // Escalation failed — items still in result
        }
      }

      this.emit({
        pipeline: this.name,
        tier: 3,
        action: "human",
        latencyMs: 0,
        costEstimate: 0,
      });
    }

    result.latencyMs = performance.now() - start;
    return result;
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
