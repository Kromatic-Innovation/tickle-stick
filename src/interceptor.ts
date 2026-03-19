import type { InboundMessage, TierResult, TriageProvider } from "./types.js";
import type { TickleStickConfig } from "./config/schema.js";
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
import { AnthropicTriageProvider } from "./providers/anthropic.js";
import { OpenAITriageProvider } from "./providers/openai.js";

export interface InterceptorOptions {
  config: TickleStickConfig;
  logSink?: LogSink;
}

export class Interceptor {
  private readonly config: TickleStickConfig;
  private readonly logger: LogSink | null;
  private readonly metrics: MetricsCollector;
  private readonly provider: TriageProvider | null;

  constructor(options: InterceptorOptions) {
    this.config = options.config;
    this.logger = createLogger(
      options.config.tickleStick.telemetry,
      options.logSink,
    );
    this.metrics = new MetricsCollector();
    this.provider = this.initProvider();
  }

  private initProvider(): TriageProvider | null {
    const tier1 = this.config.tickleStick.tier1;
    if (!tier1) return null;

    const providers = this.config.tickleStick.providers;
    const providerName = tier1.provider;
    const timeout = tier1.timeout;

    switch (providerName) {
      case "anthropic": {
        const cfg = providers.anthropic;
        if (!cfg)
          throw new Error(
            "Tier 1 references anthropic but no provider config found",
          );
        return new AnthropicTriageProvider(cfg, tier1.model, timeout);
      }
      case "openai": {
        const cfg = providers.openai;
        if (!cfg)
          throw new Error(
            "Tier 1 references openai but no provider config found",
          );
        return new OpenAITriageProvider(cfg, tier1.model, timeout);
      }
      default:
        throw new Error(`Unknown provider: ${providerName}`);
    }
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

    // Tier 1: Cheap model triage
    if (this.config.tickleStick.tier1 && this.provider) {
      try {
        const tier1Result = await processTier1(
          message,
          this.config.tickleStick.tier1,
          this.provider,
        );

        if (tier1Result.action === "human") {
          // Route to Tier 3
          result = await processTier3(message, this.config.tickleStick.tier3);
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
    if (this.logger) {
      const event = buildTelemetryEvent(
        message,
        result,
        this.config.tickleStick.telemetry,
      );
      this.logger(event);
    }
  }

  getMetrics() {
    return this.metrics.getMetrics();
  }

  resetMetrics() {
    this.metrics.reset();
  }
}
