import { describe, it, expect, vi } from "vitest";
import { classifyItem } from "../src/tiers/tier1-triage.js";
import type { WorkItem, TriageProvider } from "../src/types.js";

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

const stageConfig = {
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
      stageConfig,
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
      stageConfig,
      provider,
    );

    expect(classified.classification).toBe("needs-reasoning");
  });

  it("overrides to needs-reasoning when confidence is below threshold", async () => {
    const provider = mockProvider({
      classification: "routine",
      confidence: 0.5,
    });
    const { classified } = await classifyItem(
      makeItem("test"),
      stageConfig,
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
      stageConfig,
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
      stageConfig,
      provider,
    );

    expect(costEstimate).toBe(0.001);
  });

  it("tracks latency", async () => {
    const provider = mockProvider();
    const { latencyMs } = await classifyItem(
      makeItem("test"),
      stageConfig,
      provider,
    );

    expect(latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("sends summary + body to provider when body exists", async () => {
    const provider = mockProvider();
    await classifyItem(
      makeItem("Subject line", "Full body text"),
      stageConfig,
      provider,
    );

    expect(provider.classify).toHaveBeenCalledWith(
      "[type: test]\nSubject line\nFull body text",
      "Classify this item.",
    );
  });

  it("sends only summary when no body", async () => {
    const provider = mockProvider();
    await classifyItem(makeItem("Just a summary"), stageConfig, provider);

    expect(provider.classify).toHaveBeenCalledWith(
      "[type: test]\nJust a summary",
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
      stageConfig,
      provider,
    );

    expect(classified.tier1Response).toBe("Nothing important");
  });

  it("uses custom per-token rates from stage config (L5)", async () => {
    const provider = mockProvider({
      classification: "routine",
      confidence: 0.9,
      tokenUsage: { input: 1000, output: 500 },
    });
    const { costEstimate } = await classifyItem(
      makeItem("test"),
      {
        ...stageConfig,
        // 10× the default Haiku/4o-mini rates → easy to verify
        costPerInputToken: 0.0000025,
        costPerOutputToken: 0.0000125,
      },
      provider,
    );

    // 1000 * 0.0000025 + 500 * 0.0000125 = 0.0025 + 0.00625 = 0.00875
    expect(costEstimate).toBeCloseTo(0.00875, 6);
  });

  it("uses custom defaultCostEstimate when provider returns no tokenUsage (L5)", async () => {
    const provider = mockProvider({
      classification: "routine",
      confidence: 0.9,
    });
    const { costEstimate } = await classifyItem(
      makeItem("test"),
      { ...stageConfig, defaultCostEstimate: 0.005 },
      provider,
    );

    expect(costEstimate).toBe(0.005);
  });
});
