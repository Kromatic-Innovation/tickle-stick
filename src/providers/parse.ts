import type { TriageDecision } from "../types.js";

/**
 * Parse a model's text response into a TriageDecision.
 * Extracts JSON from plain text or markdown-wrapped code blocks.
 * Returns a safe fallback (escalate, confidence 0) on any parse failure.
 */
export function parseTriageResponse(text: string): TriageDecision {
  try {
    // Extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { action: "escalate", confidence: 0 };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      action?: string;
      response?: string;
      confidence?: number;
    };

    const action = parsed.action;
    if (action !== "deflect" && action !== "escalate" && action !== "human") {
      return { action: "escalate", confidence: 0 };
    }

    return {
      action,
      response:
        typeof parsed.response === "string" ? parsed.response : undefined,
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch {
    return { action: "escalate", confidence: 0 };
  }
}
