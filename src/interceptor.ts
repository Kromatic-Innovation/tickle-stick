import type {
  AlertSink,
  BudgetStatus,
  InboundMessage,
  StorageAdapter,
  TierResult,
  TriageProvider,
} from "./types.js";
import type { TickleStickConfig } from "./config/schema.js";
import { BudgetManager } from "./budget/budget-manager.js";
import { processTier0 } from "./tiers/tier0-deterministic.js";
import { processTier1 } from "./tiers/tier1-triage.js";
import { processTier2 } from "./tiers/tier2-passthrough.js";
import { processTier3 } from "./tiers/tier3-human.js";
import {
  createLogger,
  buildTelemetryEvent,
  type LogSink,
} from "./telemetry/logger.js";
import { MetricsCollector } from "./telemetry/metrics.js";

export interface InterceptorOptions {
  config: TickleStickConfig;
  triageProvider?: TriageProvider;
  logSink?: LogSink;
  /** Storage adapter for persisting events and querying spend. */
  storage?: StorageAdapter;
  /** Callback for budget alert delivery. */
  alertSink?: AlertSink;
  /** IANA timezone for budget day/week boundaries. Default: "UTC". */
  timezone?: string;
}

export class Interceptor {
  private readonly config: TickleStickConfig;
  private readonly logger: LogSink | null;
  private readonly metrics: MetricsCollector;
  private readonly provider: TriageProvider | null;
  private readonly budgetManager: BudgetManager | null;

  constructor(options: InterceptorOptions) {
    this.config = options.config;
    this.logger = createLogger(
      options.config.tickleStick.telemetry,
      options.logSink,
    );
    this.metrics = new MetricsCollector();
    this.provider = options.triageProvider ?? null;
    this.budgetManager = options.config.tickleStick.budget
      ? new BudgetManager({
          config: options.config.tickleStick.budget,
          storage: options.storage,
          alertSink: options.alertSink,
          timezone: options.timezone,
        })
      : null;
  }

  async process(message: InboundMessage): Promise<TierResult> {
    let result: TierResult;

    // Tier 0: Deterministic
    try {
      const tier0Result = processTier0(message, this.config.tickleStick.tier0);
      if (tier0Result) {
        result = tier0Result;
        this.emit(message, result);
        return result;
      }
    } catch (err) {
      console.warn("[tickle-stick] Tier 0 error, continuing to Tier 1:", err);
    }

    // Tier 1: Cheap model triage (skip if budget exceeded)
    const budgetOk = !this.budgetManager?.isBudgetExceeded();
    if (this.config.tickleStick.tier1 && this.provider && budgetOk) {
      try {
        const tier1Result = await processTier1(
          message,
          this.config.tickleStick.tier1,
          this.provider,
        );

        if (tier1Result.action === "human") {
          // Route to Tier 3
          result = processTier3(message);
          this.emit(message, result);
          return result;
        }

        if (tier1Result.action === "deflect") {
          result = tier1Result;
          this.emit(message, result);
          return result;
        }

        // "escalate" → fall through to Tier 2
      } catch (err) {
        console.warn(
          "[tickle-stick] Tier 1 error, falling through to Tier 2:",
          err,
        );
      }
    }

    // Tier 2: Passthrough
    result = processTier2();
    this.emit(message, result);
    return result;
  }

  private emit(message: InboundMessage, result: TierResult): void {
    this.metrics.record(result);
    const event = buildTelemetryEvent(
      message,
      result,
      this.config.tickleStick.telemetry,
    );
    if (this.logger) {
      this.logger(event);
    }
    if (this.budgetManager) {
      this.budgetManager.record(event).catch(() => {
        /* budget recording is best-effort */
      });
    }
  }

  getMetrics() {
    return this.metrics.getMetrics();
  }

  resetMetrics() {
    this.metrics.reset();
  }

  /** Prune old triage events from storage. Returns count deleted. */
  async pruneBudgetEvents(): Promise<number> {
    return this.budgetManager?.prune() ?? 0;
  }

  /** Whether the budget has been exceeded. */
  isBudgetExceeded(): boolean {
    return this.budgetManager?.isBudgetExceeded() ?? false;
  }

  /** Return a snapshot of current budget state, or null if no budget configured. */
  async getBudgetStatus(): Promise<BudgetStatus | null> {
    return this.budgetManager?.getBudgetStatus() ?? null;
  }
}
