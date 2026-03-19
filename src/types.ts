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
