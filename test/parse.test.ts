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

  it("extracts JSON surrounded by text", () => {
    const result = parseClassificationResponse(
      'Here is my classification:\n{"classification": "human", "confidence": 0.9}\nDone.',
    );

    expect(result.classification).toBe("human");
    expect(result.confidence).toBe(0.9);
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
    for (const c of ["routine", "urgent", "needs-reasoning", "human"]) {
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
});
