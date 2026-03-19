import { describe, it, expect } from "vitest";
import { parseTriageResponse } from "../src/providers/parse.js";

describe("parseTriageResponse", () => {
  it("parses valid JSON response", () => {
    const result = parseTriageResponse(
      '{"action": "deflect", "response": "Hello!", "confidence": 0.95}',
    );

    expect(result.action).toBe("deflect");
    expect(result.response).toBe("Hello!");
    expect(result.confidence).toBe(0.95);
  });

  it("extracts JSON from markdown code blocks", () => {
    const result = parseTriageResponse(
      '```json\n{"action": "escalate", "confidence": 0.8}\n```',
    );

    expect(result.action).toBe("escalate");
    expect(result.confidence).toBe(0.8);
  });

  it("extracts JSON surrounded by text", () => {
    const result = parseTriageResponse(
      'Here is my classification:\n{"action": "human", "confidence": 0.9}\nDone.',
    );

    expect(result.action).toBe("human");
    expect(result.confidence).toBe(0.9);
  });

  it("returns escalate with confidence 0 for invalid JSON", () => {
    const result = parseTriageResponse("this is not json at all");

    expect(result.action).toBe("escalate");
    expect(result.confidence).toBe(0);
  });

  it("returns escalate with confidence 0 for empty string", () => {
    const result = parseTriageResponse("");

    expect(result.action).toBe("escalate");
    expect(result.confidence).toBe(0);
  });

  it("returns escalate for unknown action", () => {
    const result = parseTriageResponse(
      '{"action": "unknown", "confidence": 0.9}',
    );

    expect(result.action).toBe("escalate");
    expect(result.confidence).toBe(0);
  });

  it("defaults confidence to 0.5 when missing", () => {
    const result = parseTriageResponse('{"action": "deflect"}');

    expect(result.action).toBe("deflect");
    expect(result.confidence).toBe(0.5);
  });

  it("omits response when not a string", () => {
    const result = parseTriageResponse(
      '{"action": "deflect", "response": 123, "confidence": 0.8}',
    );

    expect(result.action).toBe("deflect");
    expect(result.response).toBeUndefined();
  });

  it("returns escalate for malformed JSON", () => {
    const result = parseTriageResponse('{"action": "deflect", broken}');

    expect(result.action).toBe("escalate");
    expect(result.confidence).toBe(0);
  });
});
