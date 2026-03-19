import type { InboundMessage, TierResult } from "../types.js";

/**
 * Tier 3: Human escalation decision.
 *
 * Returns a result signaling that the message needs a human.
 * Actual dispatch (email, Slack, webhook) is the host's responsibility —
 * the host reads `action: "human"` and routes accordingly without
 * re-triggering the agent loop.
 */
export function processTier3(message: InboundMessage): TierResult {
  return {
    tier: 3,
    action: "human",
    costEstimate: 0,
    latencyMs: 0,
    response: "Your message has been escalated to a human team member.",
    metadata: {
      messageId: message.id,
      channel: message.channel,
      from: message.from,
      subject: message.subject,
    },
  };
}
