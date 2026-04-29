import { CLASSIFICATIONS, type ClassificationResult } from "../types.js";

const VALID_CLASSIFICATIONS = new Set<string>(CLASSIFICATIONS);

/**
 * Parse a model's text response into a ClassificationResult.
 * Extracts JSON from plain text or markdown-wrapped code blocks.
 * Returns a safe fallback (needs-reasoning, confidence 0) on parse failure
 * or on any unrecognized classification value.
 */
export function parseClassificationResponse(
  text: string,
): ClassificationResult {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { classification: "needs-reasoning", confidence: 0 };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      classification?: string;
      response?: string;
      confidence?: number;
    };

    const classification = parsed.classification;

    if (!classification || !VALID_CLASSIFICATIONS.has(classification)) {
      return { classification: "needs-reasoning", confidence: 0 };
    }

    return {
      classification: classification as ClassificationResult["classification"],
      response:
        typeof parsed.response === "string" ? parsed.response : undefined,
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch {
    return { classification: "needs-reasoning", confidence: 0 };
  }
}
