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
  classification: "routine" | "urgent" | "needs-reasoning";
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
  classification: "routine" | "urgent" | "needs-reasoning";
  response?: string;
  confidence: number;
  tokenUsage?: { input: number; output: number };
}

/** Provider for cheap model classification. Host injects implementation. */
export interface TriageProvider {
  readonly name: string;
  classify(text: string, systemPrompt: string): Promise<ClassificationResult>;
}

/** Callback for expensive model or callback stages. */
export type StageCallback = (
  items: ClassifiedItem[],
  prompt: string,
) => Promise<string>;

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
