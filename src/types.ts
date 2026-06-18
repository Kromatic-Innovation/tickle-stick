/** Classification produced by a cheap model triage stage. */
export type Classification = "routine" | "urgent" | "needs-reasoning";

/** Allowed classification values, exposed as a runtime tuple for validation. */
export const CLASSIFICATIONS = [
  "routine",
  "urgent",
  "needs-reasoning",
] as const satisfies readonly Classification[];

/** A work item produced by a script stage or external source. */
export interface WorkItem {
  id: string;
  source: string;
  type: string;
  summary: string;
  body?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

/** Classification result from a cheap model stage. */
export interface ClassifiedItem extends WorkItem {
  classification: Classification;
  confidence: number;
  tier1Response?: string;
}

/** Output from a single pipeline stage. */
export interface StageResult {
  name: string;
  type: "script" | "model" | "callback";
  items: WorkItem[] | ClassifiedItem[];
  output?: string;
  costEstimate: number;
  latencyMs: number;
  /**
   * True when a script stage's command failed (timeout, non-zero exit,
   * spawn error, or non-WorkItem[] output). Lets consumers distinguish a
   * failed gather from a legitimately empty one — both still yield zero
   * items. Paired with the `onError` callback for the failure detail.
   */
  errored?: boolean;
}

/** Result of processing work items through the pipeline. */
export interface PipelineResult {
  pipeline: string;
  stageResults: StageResult[];
  totalItems: number;
  costEstimate: number;
  latencyMs: number;
}

/** Raw classification from a model provider. */
export interface ClassificationResult {
  classification: Classification;
  response?: string;
  confidence: number;
  tokenUsage?: { input: number; output: number };
  /** Provider identifier (e.g. "anthropic", "openai"); set by the provider implementation. */
  provider?: string;
  /** Model identifier (e.g. "claude-haiku-4-5"); set by the provider implementation. */
  model?: string;
}

/** Provider for cheap model classification. Host injects implementation.
 *
 * `classify()` is for the message-triage schema (routine | urgent |
 * needs-reasoning). Callers that drive the model with a different system
 * prompt and want the raw response text should use `classifyRaw()` and
 * own their own parsing — `classify()` would otherwise silently discard
 * non-conforming responses via the message-triage parser.
 *
 * `classifyRaw()` is optional so existing in-process providers that only
 * implement `classify()` continue to work; callers should feature-detect
 * before invoking it.
 */
export interface TriageProvider {
  readonly name: string;
  classify(text: string, systemPrompt: string): Promise<ClassificationResult>;
  classifyRaw?(text: string, systemPrompt: string): Promise<string>;
}

/** Callback for expensive model or callback stages. */
export type StageCallback = (
  items: ClassifiedItem[],
  prompt: string,
) => Promise<string>;

/**
 * Provider for expensive-model and callback stages. Symmetric counterpart
 * to {@link TriageProvider}: where `TriageProvider` handles cheap-model
 * classification, `ExpensiveStageProvider` routes expensive-model and
 * callback stages to their handlers, keyed by stage name. Hosts inject
 * one entry per expensive stage.
 */
export type ExpensiveStageProvider = Record<string, StageCallback>;

/** Storage adapter for persisting pipeline events. Host provides implementation. */
export interface StorageAdapter {
  writeEvent(
    event: import("./telemetry/logger.js").TelemetryEvent,
  ): void | Promise<void>;
  getSpendSince(since: string): number | Promise<number>;
  prune(before: string): number | Promise<number>;
}

/** Alert fired when a budget threshold is crossed. */
export interface BudgetAlert {
  type: "threshold" | "cap";
  level: "daily" | "weekly";
  currentSpend: number;
  limit: number;
  percentage: number;
  message: string;
}

/** Callback for delivering budget alerts. Host decides channel/mechanism. */
export type AlertSink = (alert: BudgetAlert) => void | Promise<void>;

/** Snapshot of current budget state. */
export interface BudgetStatus {
  dailySpend: number;
  weeklySpend: number;
  maxDailySpend: number | null;
  maxWeeklySpend: number | null;
  exceeded: boolean;
}
