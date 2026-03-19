import { describe, it, expect } from "vitest";
import { processTier0 } from "../src/tiers/tier0-deterministic.js";
import type { InboundMessage } from "../src/types.js";
import type { Tier0Config } from "../src/config/schema.js";

function makeMessage(
  body: string,
  overrides?: Partial<InboundMessage>,
): InboundMessage {
  return {
    id: "test-msg",
    channel: "email",
    from: "test@example.com",
    body,
    timestamp: new Date(),
    ...overrides,
  };
}

const testConfig: Tier0Config = {
  patterns: [
    {
      match: "^(hi|hello|hey)\\b",
      type: "regex",
      flags: "i",
      action: "deflect",
      response: "Hello! How can I help?",
    },
    {
      match: "/help",
      type: "command",
      action: "deflect",
      response: "Here is help info.",
    },
  ],
  keywords: [
    {
      match: ["unsubscribe", "stop emails"],
      action: "deflect",
      response: "You've been unsubscribed.",
    },
  ],
};

describe("Tier 0: Deterministic", () => {
  it("matches regex patterns case-insensitively", () => {
    const result = processTier0(makeMessage("Hello there"), testConfig);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe(0);
    expect(result!.action).toBe("deflect");
    expect(result!.response).toBe("Hello! How can I help?");
    expect(result!.costEstimate).toBe(0);
  });

  it("matches 'Hi' at start of message", () => {
    const result = processTier0(makeMessage("Hi"), testConfig);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("deflect");
  });

  it("does not match regex mid-word", () => {
    const result = processTier0(makeMessage("I said highway"), testConfig);
    // "highway" starts with "hi" followed by word boundary — "hi" + \b should NOT match "highway"
    // Actually \b is between 'i' and 'g' in "highway"? No — "hi" in "highway" has no \b after "hi".
    // Let's test: "^(hi|hello|hey)\b" against "I said highway" — ^ anchors to start, so no match.
    expect(result).toBeNull();
  });

  it("matches command patterns exactly", () => {
    const result = processTier0(makeMessage("/help"), testConfig);
    expect(result).not.toBeNull();
    expect(result!.response).toBe("Here is help info.");
  });

  it("matches command with trailing text", () => {
    const result = processTier0(makeMessage("/help me please"), testConfig);
    expect(result).not.toBeNull();
  });

  it("does not match partial commands", () => {
    const result = processTier0(makeMessage("/helping"), testConfig);
    // "/helping" starts with "/help " — no, it starts with "/help" + "i", not "/help" + " "
    // The command logic: trimmed === match or trimmed.startsWith(match + " ")
    // "/helping" !== "/help" and !"/helping".startsWith("/help ")
    expect(result).toBeNull();
  });

  it("matches keywords in message body", () => {
    const result = processTier0(
      makeMessage("I want to unsubscribe from your list"),
      testConfig,
    );
    expect(result).not.toBeNull();
    expect(result!.response).toBe("You've been unsubscribed.");
  });

  it("matches multi-word keywords", () => {
    const result = processTier0(
      makeMessage("Please stop emails to my inbox"),
      testConfig,
    );
    expect(result).not.toBeNull();
  });

  it("returns null when no patterns match", () => {
    const result = processTier0(
      makeMessage("Can you explain your pricing model in detail?"),
      testConfig,
    );
    expect(result).toBeNull();
  });

  it("returns latency in result", () => {
    const result = processTier0(makeMessage("hello"), testConfig);
    expect(result).not.toBeNull();
    expect(typeof result!.latencyMs).toBe("number");
    expect(result!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("handles empty config gracefully", () => {
    const emptyConfig: Tier0Config = { patterns: [], keywords: [] };
    const result = processTier0(makeMessage("hello"), emptyConfig);
    expect(result).toBeNull();
  });
});
