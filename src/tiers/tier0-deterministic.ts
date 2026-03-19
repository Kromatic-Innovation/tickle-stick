import type { InboundMessage, TierResult } from "../types.js";
import type { Tier0Config } from "../config/schema.js";

function matchesPattern(
  text: string,
  match: string,
  type: string,
  flags?: string,
): boolean {
  switch (type) {
    case "regex": {
      const regex = new RegExp(match, flags);
      return regex.test(text);
    }
    case "command": {
      const trimmed = text.trim().toLowerCase();
      return (
        trimmed === match.toLowerCase() ||
        trimmed.startsWith(match.toLowerCase() + " ")
      );
    }
    case "keyword": {
      return text.toLowerCase().includes(match.toLowerCase());
    }
    default:
      return false;
  }
}

export function processTier0(
  message: InboundMessage,
  config: Tier0Config,
): TierResult | null {
  const start = performance.now();
  const text = message.body;

  // Check pattern rules
  for (const rule of config.patterns) {
    if (matchesPattern(text, rule.match, rule.type, rule.flags)) {
      return {
        tier: 0,
        action: "deflect",
        response: rule.response,
        costEstimate: 0,
        latencyMs: performance.now() - start,
      };
    }
  }

  // Check keyword groups
  for (const group of config.keywords) {
    const lowerText = text.toLowerCase();
    const matched = group.match.some((kw) =>
      lowerText.includes(kw.toLowerCase()),
    );
    if (matched) {
      return {
        tier: 0,
        action: "deflect",
        response: group.response,
        costEstimate: 0,
        latencyMs: performance.now() - start,
      };
    }
  }

  return null;
}
