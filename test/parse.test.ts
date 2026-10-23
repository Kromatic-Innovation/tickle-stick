import { describe, it, expect } from "vitest";
import { parseClassificationResponse } from "../src/providers/parse.js";

describe("parseClassificationResponse", () => {
  it("parses valid JSON response", () => {
    const result = parseClassificationResponse(
      '{"classification": "routine", "response": "Normal item", "confidence": 0.95}',
    );

    expect(result.classification).toBe("routine");
    expect(result.response).toBe("Normal item");
    expect(result.confidence).toBe(0.95);
  });

  it("extracts JSON from markdown code blocks", () => {
    const result = parseClassificationResponse(
      '```json\n{"classification": "needs-reasoning", "confidence": 0.8}\n```',
    );

    expect(result.classification).toBe("needs-reasoning");
    expect(result.confidence).toBe(0.8);
  });

  it("rejects unknown classification (legacy 'human' shim removed in 0.4.x → 1.0)", () => {
    const result = parseClassificationResponse(
      'Here is my classification:\n{"classification": "human", "confidence": 0.9}\nDone.',
    );

    // "human" is no longer mapped — falls through to the safe default.
    expect(result.classification).toBe("needs-reasoning");
    expect(result.confidence).toBe(0);
  });

  it("returns needs-reasoning with confidence 0 for invalid JSON", () => {
    const result = parseClassificationResponse("this is not json at all");

    expect(result.classification).toBe("needs-reasoning");
    expect(result.confidence).toBe(0);
  });

  it("returns needs-reasoning with confidence 0 for empty string", () => {
    const result = parseClassificationResponse("");

    expect(result.classification).toBe("needs-reasoning");
    expect(result.confidence).toBe(0);
  });

  it("returns needs-reasoning for unknown classification", () => {
    const result = parseClassificationResponse(
      '{"classification": "unknown", "confidence": 0.9}',
    );

    expect(result.classification).toBe("needs-reasoning");
    expect(result.confidence).toBe(0);
  });

  it("accepts all valid classifications", () => {
    for (const c of ["routine", "urgent", "needs-reasoning"]) {
      const result = parseClassificationResponse(
        `{"classification": "${c}", "confidence": 0.8}`,
      );
      expect(result.classification).toBe(c);
    }
  });

  it("defaults confidence to 0.5 when missing", () => {
    const result = parseClassificationResponse('{"classification": "routine"}');

    expect(result.classification).toBe("routine");
    expect(result.confidence).toBe(0.5);
  });

  it("omits response when not a string", () => {
    const result = parseClassificationResponse(
      '{"classification": "routine", "response": 123, "confidence": 0.8}',
    );

    expect(result.classification).toBe("routine");
    expect(result.response).toBeUndefined();
  });

  it("returns needs-reasoning for malformed JSON", () => {
    const result = parseClassificationResponse(
      '{"classification": "routine", broken}',
    );

    expect(result.classification).toBe("needs-reasoning");
    expect(result.confidence).toBe(0);
  });

  // --- AC1 / AC5 (probe P6): confidence range validation ---

  it("rejects confidence above 1 instead of accepting it unclamped (P6 overOne)", () => {
    const result = parseClassificationResponse(
      '{"classification": "routine", "confidence": 7}',
    );

    expect(result.classification).toBe("needs-reasoning");
    expect(result.confidence).toBe(0);
  });

  it("rejects negative confidence instead of accepting it (P6 negative)", () => {
    const result = parseClassificationResponse(
      '{"classification": "routine", "confidence": -1}',
    );

    expect(result.classification).toBe("needs-reasoning");
    expect(result.confidence).toBe(0);
  });

  it("rejects non-finite confidence (e.g. an overflowed numeric literal)", () => {
    // 1e400 overflows float64 and JSON.parse yields Infinity for it.
    const result = parseClassificationResponse(
      '{"classification": "routine", "confidence": 1e400}',
    );

    expect(result.classification).toBe("needs-reasoning");
    expect(result.confidence).toBe(0);
  });

  // --- AC2 / AC5 (probe P6): non-greedy JSON extraction ---

  it("parses a valid JSON object followed by unrelated trailing brace text (P6 trailingBrace)", () => {
    const result = parseClassificationResponse(
      '{"classification": "routine", "confidence": 0.9} note: {x}',
    );

    expect(result.classification).toBe("routine");
    expect(result.confidence).toBe(0.9);
  });

});
