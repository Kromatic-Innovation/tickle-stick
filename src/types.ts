export interface InboundMessage {
  id: string;
  channel: string;
  from: string;
  subject?: string;
  body: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export type TierAction = "deflect" | "escalate" | "human" | "passthrough";

export interface TierResult {
  tier: 0 | 1 | 2 | 3;
  action: TierAction;
  response?: string;
  confidence?: number;
  costEstimate: number;
  latencyMs: number;
  metadata?: Record<string, unknown>;
}

export interface TriageDecision {
  action: "deflect" | "escalate" | "human";
  response?: string;
  confidence: number;
  tokenUsage?: { input: number; output: number };
}

export interface TriageProvider {
  readonly name: string;
  triage(
    message: InboundMessage,
    systemPrompt: string,
  ): Promise<TriageDecision>;
}

/** Storage adapter for persisting triage events. Host provides implementation. */
export interface StorageAdapter {
  /** Persist a single triage event. */
  writeEvent(
    event: import("./telemetry/logger.js").TelemetryEvent,
  ): void | Promise<void>;
  /** Return total spend since the given ISO timestamp. */
  getSpendSince(since: string): number | Promise<number>;
  /** Delete events older than the given ISO timestamp. Returns count deleted. */
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

/** Snapshot of current budget state, returned by getBudgetStatus(). */
export interface BudgetStatus {
  dailySpend: number;
  weeklySpend: number;
  maxDailySpend: number | null;
  maxWeeklySpend: number | null;
  exceeded: boolean;
}
