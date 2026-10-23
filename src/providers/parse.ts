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

/**
 * True when `text` mentions urgency anywhere, independent of the
 * structured `classification` field. Deliberately simple and
 * deliberately conservative (favors escalation over a silent drop).
 */
function mentionsUrgent(text: string): boolean {
  return /\burgent\b/i.test(text);
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
 * Non-skippable safety net: a "routine" verdict alone never suppresses
 * escalation when the raw response text also mentions urgency anywhere,
 * regardless of how confident the structured verdict claims to be. See
 * tickle-stick#247 (AC4) — this intentionally lives entirely here, independent
 * of the confidence/threshold machinery in tier1-triage.ts, so a forged or
 * injected high-confidence "routine" result cannot drop an item that the
 * raw text itself flags as urgent.
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

    if (classification === "routine" && mentionsUrgent(text)) {
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
