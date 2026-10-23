import type { TelemetryConfig } from "../config/schema.js";

export interface TelemetryEvent {
  event: "tickle_stick.pipeline";
  pipeline: string;
  itemId?: string;
  source?: string;
  tier: number;
  action: string;
  latencyMs: number;
  /** USD. Exactly one cost-bearing event per classified item (see `granularity`). */
  costEstimate: number;
  confidence?: number;
  timestamp: string;
  /**
   * Discriminates a per-item costed event ("call") from a per-stage
   * aggregate ("stage"). Required — storage and metrics consumers key on
   * it to count items without double-counting the stage rollup
   * (tickle-stick#254); `tier` alone is ambiguous (stage index on
   * aggregates vs. a literal tier number on per-item events) and is left
   * unchanged rather than repurposed.
   */
  granularity: "call" | "stage";
  /** Identifier of the model provider, e.g. "anthropic" or "openai". */
  provider?: string;
  /** Model identifier as reported by the provider, e.g. "claude-haiku-4-5". */
  model?: string;
  /** Input token count from the provider's usage payload. */
  tokensIn?: number;
  /** Output token count from the provider's usage payload. */
  tokensOut?: number;
  /**
   * How `costEstimate` was derived. "estimated" today for every value
   * tickle-stick computes (including the `DEFAULT_COST_ESTIMATE` flat-rate
   * fallback); named to match the fleet usage ledger's `cost_basis` column.
   */
  costBasis?: string;
  /** Cache-read input tokens, when the provider reports them (fleet ledger alignment). */
  cacheReadInputTokens?: number;
  /** Cache-creation input tokens, when the provider reports them (fleet ledger alignment). */
  cacheCreationInputTokens?: number;
  /** Auth mode used for the call (e.g. "api_key", "subscription"), when known. */
  authMode?: string;
  /** Account identifier the call was attributed to, when known. */
  account?: string;
  /** Stage name for a per-item event, or the literal "pipeline:stage" for a stage aggregate. */
  callSite?: string;
  metadata?: Record<string, unknown>;
}

export type LogSink = (event: TelemetryEvent) => void;

function defaultJsonSink(event: TelemetryEvent): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

function defaultTextSink(event: TelemetryEvent): void {
  const parts = [
    `[tickle-stick]`,
    `pipeline=${event.pipeline}`,
    `tier=${event.tier}`,
    `action=${event.action}`,
    `latency=${event.latencyMs.toFixed(1)}ms`,
    `cost=$${event.costEstimate.toFixed(4)}`,
  ];
  if (event.itemId) {
    parts.push(`item=${event.itemId}`);
  }
  if (event.confidence !== undefined) {
    parts.push(`confidence=${event.confidence.toFixed(2)}`);
  }
  process.stdout.write(parts.join(" ") + "\n");
}

export function createLogger(
  config: TelemetryConfig,
  customSink?: LogSink,
): LogSink | null {
  if (!config.enabled) return null;
  return (
    customSink ?? (config.format === "json" ? defaultJsonSink : defaultTextSink)
  );
}
