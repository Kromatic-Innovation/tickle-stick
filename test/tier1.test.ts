import { describe, it, expect, vi } from "vitest";
import { processTier1 } from "../src/tiers/tier1-triage.js";
import type { InboundMessage, TriageProvider } from "../src/types.js";
import type { Tier1Config } from "../src/config/schema.js";

function makeMessage(body: string): InboundMessage {
  return {
    id: "test-msg",
    channel: "email",
    from: "test@example.com",
    body,
    timestamp: new Date(),
  };
}

const tier1Config: Tier1Config = {
  systemPrompt: "Classify this message.",
  confidenceThreshold: 0.7,
  timeout: 5000,
};

function mockProvider(
  overrides: Partial<Awaited<ReturnType<TriageProvider["triage"]>>> = {},
): TriageProvider {
  return {
    name: "mock",
    triage: vi.fn().mockResolvedValue({
      action: "deflect",
      response: "Test response",
      confidence: 0.9,
      ...overrides,
    }),
  };
}

describe("Tier 1: Triage", () => {
  it("returns deflect when provider says deflect with high confidence", async () => {
    const provider = mockProvider({ action: "deflect", confidence: 0.9 });
    const result = await processTier1(
      makeMessage("test"),
      tier1Config,
      provider,
    );

    expect(result.tier).toBe(1);
    expect(result.action).toBe("deflect");
    expect(result.confidence).toBe(0.9);
  });

  it("returns escalate when provider says escalate", async () => {
    const provider = mockProvider({ action: "escalate", confidence: 0.85 });
    const result = await processTier1(
      makeMessage("test"),
      tier1Config,
      provider,
    );

    expect(result.tier).toBe(1);
    expect(result.action).toBe("escalate");
  });

  it("returns human when provider says human", async () => {
    const provider = mockProvider({ action: "human", confidence: 0.95 });
    const result = await processTier1(
      makeMessage("test"),
      tier1Config,
      provider,
    );

    expect(result.tier).toBe(1);
    expect(result.action).toBe("human");
  });

  it("overrides to escalate when confidence is below threshold", async () => {
    const provider = mockProvider({ action: "deflect", confidence: 0.5 });
    const result = await processTier1(
      makeMessage("test"),
      tier1Config,
      provider,
    );

    expect(result.action).toBe("escalate");
    expect(result.metadata).toEqual({ reason: "below_confidence_threshold" });
  });

  it("estimates cost from token usage", async () => {
    const provider = mockProvider({
      action: "deflect",
      confidence: 0.9,
      tokenUsage: { input: 100, output: 50 },
    });
    const result = await processTier1(
      makeMessage("test"),
      tier1Config,
      provider,
    );

    expect(result.costEstimate).toBeGreaterThan(0);
    expect(result.costEstimate).toBeLessThan(0.01);
  });

  it("uses default cost estimate when no token usage", async () => {
    const provider = mockProvider({ action: "deflect", confidence: 0.9 });
    const result = await processTier1(
      makeMessage("test"),
      tier1Config,
      provider,
    );

    expect(result.costEstimate).toBe(0.001);
  });

  it("tracks latency", async () => {
    const provider = mockProvider();
    const result = await processTier1(
      makeMessage("test"),
      tier1Config,
      provider,
    );

    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
