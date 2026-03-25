import { describe, it, expect, vi } from "vitest";
import { classifyItem } from "../src/tiers/tier1-triage.js";
import type { WorkItem, TriageProvider } from "../src/types.js";
import type { Tier1Config } from "../src/config/schema.js";

function makeItem(summary: string, body?: string): WorkItem {
  return {
    id: "test-item",
    source: "test",
    type: "test",
    summary,
    body,
    timestamp: new Date(),
  };
}

const tier1Config: Tier1Config = {
  systemPrompt: "Classify this item.",
  confidenceThreshold: 0.7,
};

function mockProvider(
  overrides: Partial<Awaited<ReturnType<TriageProvider["classify"]>>> = {},
): TriageProvider {
  return {
    name: "mock",
    classify: vi.fn().mockResolvedValue({
      classification: "routine",
      response: "Test response",
      confidence: 0.9,
      ...overrides,
    }),
  };
}

describe("Tier 1: Classification", () => {
  it("returns routine when provider says routine with high confidence", async () => {
    const provider = mockProvider({
      classification: "routine",
      confidence: 0.9,
    });
    const { classified } = await classifyItem(
      makeItem("test"),
      tier1Config,
      provider,
    );

    expect(classified.classification).toBe("routine");
    expect(classified.confidence).toBe(0.9);
  });

  it("returns needs-reasoning when provider says needs-reasoning", async () => {
    const provider = mockProvider({
      classification: "needs-reasoning",
      confidence: 0.85,
    });
    const { classified } = await classifyItem(
      makeItem("test"),
      tier1Config,
      provider,
    );

    expect(classified.classification).toBe("needs-reasoning");
  });

  it("returns human when provider says human", async () => {
    const provider = mockProvider({
      classification: "human",
      confidence: 0.95,
    });
    const { classified } = await classifyItem(
      makeItem("test"),
      tier1Config,
      provider,
    );

    expect(classified.classification).toBe("human");
  });

  it("overrides to needs-reasoning when confidence is below threshold", async () => {
    const provider = mockProvider({
      classification: "routine",
      confidence: 0.5,
    });
    const { classified } = await classifyItem(
      makeItem("test"),
      tier1Config,
      provider,
    );

    expect(classified.classification).toBe("needs-reasoning");
  });

  it("estimates cost from token usage", async () => {
    const provider = mockProvider({
      classification: "routine",
      confidence: 0.9,
      tokenUsage: { input: 100, output: 50 },
    });
    const { costEstimate } = await classifyItem(
      makeItem("test"),
      tier1Config,
      provider,
    );

    expect(costEstimate).toBeGreaterThan(0);
    expect(costEstimate).toBeLessThan(0.01);
  });

  it("uses default cost estimate when no token usage", async () => {
    const provider = mockProvider({
      classification: "routine",
      confidence: 0.9,
    });
    const { costEstimate } = await classifyItem(
      makeItem("test"),
      tier1Config,
      provider,
    );

    expect(costEstimate).toBe(0.001);
  });

  it("tracks latency", async () => {
    const provider = mockProvider();
    const { latencyMs } = await classifyItem(
      makeItem("test"),
      tier1Config,
      provider,
    );

    expect(latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("sends summary + body to provider when body exists", async () => {
    const provider = mockProvider();
    await classifyItem(
      makeItem("Subject line", "Full body text"),
      tier1Config,
      provider,
    );

    expect(provider.classify).toHaveBeenCalledWith(
      "Subject line\n\nFull body text",
      "Classify this item.",
    );
  });

  it("sends only summary when no body", async () => {
    const provider = mockProvider();
    await classifyItem(makeItem("Just a summary"), tier1Config, provider);

    expect(provider.classify).toHaveBeenCalledWith(
      "Just a summary",
      "Classify this item.",
    );
  });

  it("preserves tier1Response in classified item", async () => {
    const provider = mockProvider({
      classification: "routine",
      response: "Nothing important",
      confidence: 0.9,
    });
    const { classified } = await classifyItem(
      makeItem("test"),
      tier1Config,
      provider,
    );

    expect(classified.tier1Response).toBe("Nothing important");
  });
});
