import type { InboundMessage, TierResult } from "../types.js";
import type { TelemetryConfig } from "../config/schema.js";

export interface TelemetryEvent {
  event: "tickle_stick.process";
  messageId: string;
  channel: string;
  tier: number;
  action: string;
  latencyMs: number;
  costEstimate: number;
  confidence?: number;
  timestamp: string;
  messagePreview?: string;
  metadata?: Record<string, unknown>;
}

export type LogSink = (event: TelemetryEvent) => void;

function defaultJsonSink(event: TelemetryEvent): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

function defaultTextSink(event: TelemetryEvent): void {
  const parts = [
    `[tickle-stick]`,
    `tier=${event.tier}`,
    `action=${event.action}`,
    `latency=${event.latencyMs.toFixed(1)}ms`,
    `cost=$${event.costEstimate.toFixed(4)}`,
    `msg=${event.messageId}`,
  ];
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

  const sink =
    customSink ??
    (config.format === "json" ? defaultJsonSink : defaultTextSink);

  return sink;
}

export function buildTelemetryEvent(
  message: InboundMessage,
  result: TierResult,
  config: TelemetryConfig,
): TelemetryEvent {
  const event: TelemetryEvent = {
    event: "tickle_stick.process",
    messageId: message.id,
    channel: message.channel,
    tier: result.tier,
    action: result.action,
    latencyMs: result.latencyMs,
    costEstimate: result.costEstimate,
    timestamp: new Date().toISOString(),
  };

  if (result.confidence !== undefined) {
    event.confidence = result.confidence;
  }

  if (config.includeMessagePreview) {
    event.messagePreview = message.body.slice(0, 100);
  }

  if (result.metadata) {
    event.metadata = result.metadata;
  }

  return event;
}
