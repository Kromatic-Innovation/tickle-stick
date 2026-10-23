import { CLASSIFICATIONS, type ClassificationResult } from "../types.js";

const VALID_CLASSIFICATIONS = new Set<string>(CLASSIFICATIONS);

/** Span of the first balanced top-level JSON object found in some text. */
interface JsonSpan {
  /** The JSON object substring itself (inclusive of its braces). */
  text: string;
  /** Index of the opening `{`. */
  start: number;
  /** Index just past the matching closing `}` (exclusive). */
  end: number;
}

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
function extractJsonObject(text: string): JsonSpan | null {
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
        return { text: text.slice(start, i + 1), start, end: i + 1 };
      }
    }
  }

  return null;
}

/**
 * True when `text` mentions urgency anywhere. Deliberately simple and
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
 * escalation when text OUTSIDE the parsed JSON object (leading or trailing
 * context around it — exactly where injected or echoed content lands)
 * mentions urgency, regardless of how confident the structured verdict
 * claims to be. See tickle-stick#247 (AC4) — this intentionally lives
 * entirely here, independent of the confidence/threshold machinery in
 * tier1-triage.ts, so a forged or injected high-confidence "routine"
 * result cannot drop an item whose surrounding raw text flags it as
 * urgent. Scoped to text OUTSIDE the JSON span (not the whole raw text)
 * so that a well-behaved provider response consisting of only the JSON
 * object — including a "response" field that happens to contain the word
 * "urgent" — can never trip the guard; a response that is pure JSON has no
 * outside text at all.
 */
export function parseClassificationResponse(
  text: string,
): ClassificationResult {
  try {
    const jsonSpan = extractJsonObject(text);
    if (!jsonSpan) {
      return { classification: "needs-reasoning", confidence: 0 };
    }

    const parsed = JSON.parse(jsonSpan.text) as {
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

    if (classification === "routine") {
      const outsideJson =
        text.slice(0, jsonSpan.start) + text.slice(jsonSpan.end);
      if (mentionsUrgent(outsideJson)) {
        return { classification: "needs-reasoning", confidence: 0 };
      }
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
