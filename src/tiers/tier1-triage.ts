import type { InboundMessage, TierResult, TriageProvider } from "../types.js";
import type { Tier1Config } from "../config/schema.js";

export async function processTier1(
  message: InboundMessage,
  config: Tier1Config,
  provider: TriageProvider,
): Promise<TierResult> {
  const start = performance.now();

  const decision = await provider.triage(message, config.systemPrompt);
  const latencyMs = performance.now() - start;

  // Estimate cost from token usage
  let costEstimate = 0.001; // Default estimate for cheap models
  if (decision.tokenUsage) {
    // Rough per-token pricing for cheap models (input + output)
    costEstimate =
      decision.tokenUsage.input * 0.00000025 +
      decision.tokenUsage.output * 0.00000125;
  }

  // If confidence is below threshold, escalate regardless of decision
  if (decision.confidence < config.confidenceThreshold) {
    return {
      tier: 1,
      action: "escalate",
      costEstimate,
      latencyMs,
      confidence: decision.confidence,
      metadata: { reason: "below_confidence_threshold" },
    };
  }

  return {
    tier: 1,
    action: decision.action,
    response: decision.response,
    confidence: decision.confidence,
    costEstimate,
    latencyMs,
  };
}
