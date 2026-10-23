import { CLASSIFICATIONS, type ClassificationResult } from "../types.js";

const VALID_CLASSIFICATIONS = new Set<string>(CLASSIFICATIONS);

/**
 * Extract the first balanced top-level JSON object from `text`, scanning
 * forward from the first `{` and tracking brace depth (ignoring braces
 * inside quoted strings) until depth returns to zero.
 *
 * Replaces a greedy first-`{`-to-last-`}` regex, which swallowed trailing
 * non-JSON content that happened to contain more brace characters (e.g. a
 * valid JSON object followed by unrelated text like `{x}`) into an invalid
 * JSON.parse candidate. Returns null when no balanced object is found.
 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/** True for a finite number in the inclusive 0..1 confidence range. */
function isValidConfidence(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

/**
 * Parse a model's text response into a ClassificationResult.
 * Extracts JSON from plain text or markdown-wrapped code blocks.
 * Returns a safe fallback (needs-reasoning, confidence 0) on parse failure,
 * on any unrecognized classification value, or on a confidence value that
 * is present but out of the 0..1 range or non-finite.
 *
 * Note (tickle-stick#247): this module intentionally does NOT guard against
 * a forged/injected high-confidence "routine" verdict. This layer only sees
 * the model's output, which is exactly what a successful prompt injection
 * controls -- it has no access to the original item text to compare
 * against. That non-skippable escalation guard lives in
 * tier1-triage.ts#classifyItem instead, where the input item is in scope.
 */
export function parseClassificationResponse(
  text: string,
): ClassificationResult {
  try {
    const jsonText = extractJsonObject(text);
    if (!jsonText) {
      return { classification: "needs-reasoning", confidence: 0 };
    }

    const parsed = JSON.parse(jsonText) as {
      classification?: string;
      response?: string;
      confidence?: number;
    };

    const classification = parsed.classification;

    if (!classification || !VALID_CLASSIFICATIONS.has(classification)) {
      return { classification: "needs-reasoning", confidence: 0 };
    }

    let confidence: number;
    if (parsed.confidence === undefined) {
      confidence = 0.5;
    } else if (isValidConfidence(parsed.confidence)) {
      confidence = parsed.confidence;
    } else {
      // Out-of-range or non-finite confidence: reject the whole result
      // rather than accepting an unclamped scalar (tickle-stick#247, AC1).
      return { classification: "needs-reasoning", confidence: 0 };
    }

    return {
      classification: classification as ClassificationResult["classification"],
      response:
        typeof parsed.response === "string" ? parsed.response : undefined,
      confidence,
    };
  } catch {
    return { classification: "needs-reasoning", confidence: 0 };
  }
}
