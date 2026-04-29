import type { TelemetryConfig } from "../config/schema.js";

export interface TelemetryEvent {
  event: "tickle_stick.pipeline";
  pipeline: string;
  itemId?: string;
  source?: string;
  tier: number;
  action: string;
  latencyMs: number;
  costEstimate: number;
  confidence?: number;
  timestamp: string;
  /** Identifier of the model provider, e.g. "anthropic" or "openai". */
  provider?: string;
  /** Model identifier as reported by the provider, e.g. "claude-haiku-4-5". */
  model?: string;
  /** Input token count from the provider's usage payload. */
  tokensIn?: number;
  /** Output token count from the provider's usage payload. */
  tokensOut?: number;
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
