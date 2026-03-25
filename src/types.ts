/** A work item produced by a Tier 0 script or external source. */
export interface WorkItem {
  id: string;
  source: string;
  type: string;
  summary: string;
  body?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

/** Classification result from Tier 1. */
export interface ClassifiedItem extends WorkItem {
  classification: "routine" | "urgent" | "needs-reasoning" | "human";
  confidence: number;
  tier1Response?: string;
}

/** Result of processing a batch of work items through the pipeline. */
export interface PipelineResult {
  pipeline: string;
  tier0Items: number;
  tier1Classified: number;
  tier2Escalated: number;
  tier3Human: number;
  costEstimate: number;
  latencyMs: number;
  routineReport?: string;
  reasoningReport?: string;
  humanItems?: ClassifiedItem[];
}

/** Raw classification from a model provider. */
export interface ClassificationResult {
  classification: "routine" | "urgent" | "needs-reasoning" | "human";
  response?: string;
  confidence: number;
  tokenUsage?: { input: number; output: number };
}

/** Provider for Tier 1 classification. Host injects implementation. */
export interface TriageProvider {
  readonly name: string;
  classify(text: string, systemPrompt: string): Promise<ClassificationResult>;
}

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
