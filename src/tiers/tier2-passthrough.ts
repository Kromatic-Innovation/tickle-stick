import type { TierResult } from "../types.js";

export function processTier2(): TierResult {
  return {
    tier: 2,
    action: "passthrough",
    costEstimate: 0,
    latencyMs: 0,
    metadata: { note: "Message passed through to host agent loop" },
  };
}
