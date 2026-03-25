import { describe, it, expect, vi, beforeEach } from "vitest";
import { Pipeline } from "../src/pipeline.js";
import type { PipelineConfigEntry } from "../src/config/schema.js";
import type { WorkItem, TriageProvider } from "../src/types.js";

function makeConfig(
  overrides: Partial<PipelineConfigEntry> = {},
): PipelineConfigEntry {
  return {
    tier0: {
      command: "echo",
      args: ["[]"],
      timeout: 5000,
    },
    ...overrides,
  };
}

function mockProvider(
  classification:
    | "routine"
    | "urgent"
    | "needs-reasoning"
    | "human" = "routine",
  confidence = 0.9,
): TriageProvider {
  return {
    name: "mock",
    classify: vi.fn().mockResolvedValue({
      classification,
      response: `Classified as ${classification}`,
      confidence,
    }),
  };
}

// Helper to make a pipeline that returns items directly (bypasses script)
function makePipelineWithItems(
  items: WorkItem[],
  overrides: Partial<Parameters<typeof Pipeline.prototype.run>[0]> & {
    config?: Partial<PipelineConfigEntry>;
    provider?: TriageProvider;
    onTier2?: (items: unknown[], prompt: string) => Promise<string>;
    onTier3?: (items: unknown[]) => Promise<void>;
  } = {},
) {
  // We'll use a script that outputs the items as JSON
  const json = JSON.stringify(
    items.map((i) => ({ ...i, timestamp: i.timestamp.toISOString() })),
  );
  const config = makeConfig({
    tier0: {
      command: "node",
      args: ["-e", `process.stdout.write(${JSON.stringify(json)})`],
      timeout: 5000,
    },
    ...overrides.config,
  });

  return new Pipeline({
    name: "test-pipeline",
    config,
    telemetry: { enabled: false, format: "json" },
    triageProvider: overrides.provider,
    onTier2: overrides.onTier2,
    onTier3: overrides.onTier3,
  });
}

const sampleItems: WorkItem[] = [
  {
    id: "item-1",
    source: "gmail",
    type: "email",
    summary: "Meeting tomorrow at 10am",
    timestamp: new Date(),
  },
  {
    id: "item-2",
    source: "calendar",
    type: "event",
    summary: "Dentist appointment",
    timestamp: new Date(),
  },
];

describe("Pipeline", () => {
  it("returns zero-cost result when Tier 0 script returns no items", async () => {
    const pipeline = new Pipeline({
      name: "empty",
      config: makeConfig(),
      telemetry: { enabled: false, format: "json" },
    });

    const result = await pipeline.run();

    expect(result.pipeline).toBe("empty");
    expect(result.tier0Items).toBe(0);
    expect(result.tier1Classified).toBe(0);
    expect(result.tier2Escalated).toBe(0);
    expect(result.tier3Human).toBe(0);
    expect(result.costEstimate).toBe(0);
  });

  it("passes all items to Tier 2 when no Tier 1 provider", async () => {
    const onTier2 = vi.fn().mockResolvedValue("Briefing summary");
    const pipeline = makePipelineWithItems(sampleItems, {
      config: {
        tier1: { systemPrompt: "Classify", confidenceThreshold: 0.7 },
        tier2: { prompt: "Synthesize: {{items}}" },
      },
      onTier2,
    });

    const result = await pipeline.run();

    expect(result.tier0Items).toBe(2);
    expect(result.tier2Escalated).toBe(2);
    expect(onTier2).toHaveBeenCalledOnce();
    expect(result.reasoningReport).toBe("Briefing summary");
  });

  it("classifies items with Tier 1 provider", async () => {
    const provider = mockProvider("routine", 0.95);
    const pipeline = makePipelineWithItems(sampleItems, {
      config: {
        tier1: { systemPrompt: "Classify", confidenceThreshold: 0.7 },
      },
      provider,
    });

    const result = await pipeline.run();

    expect(result.tier0Items).toBe(2);
    expect(result.tier1Classified).toBe(2);
    expect(result.tier2Escalated).toBe(0);
    expect(result.costEstimate).toBeGreaterThan(0);
    expect(provider.classify).toHaveBeenCalledTimes(2);
  });

  it("routes needs-reasoning items to Tier 2", async () => {
    const provider = mockProvider("needs-reasoning", 0.9);
    const onTier2 = vi.fn().mockResolvedValue("Analysis done");
    const pipeline = makePipelineWithItems(sampleItems, {
      config: {
        tier1: { systemPrompt: "Classify", confidenceThreshold: 0.7 },
        tier2: { prompt: "Analyze: {{items}}" },
      },
      provider,
      onTier2,
    });

    const result = await pipeline.run();

    expect(result.tier2Escalated).toBe(2);
    expect(onTier2).toHaveBeenCalledOnce();
    expect(result.reasoningReport).toBe("Analysis done");
  });

  it("routes human items to Tier 3", async () => {
    const provider = mockProvider("human", 0.95);
    const onTier3 = vi.fn().mockResolvedValue(undefined);
    const pipeline = makePipelineWithItems(sampleItems, {
      config: {
        tier1: { systemPrompt: "Classify", confidenceThreshold: 0.7 },
        tier3: { route: "main" },
      },
      provider,
      onTier3,
    });

    const result = await pipeline.run();

    expect(result.tier3Human).toBe(2);
    expect(result.humanItems).toHaveLength(2);
    expect(onTier3).toHaveBeenCalledOnce();
  });

  it("escalates items when confidence below threshold", async () => {
    const provider = mockProvider("routine", 0.3);
    const onTier2 = vi.fn().mockResolvedValue("Low confidence reasoning");
    const pipeline = makePipelineWithItems(sampleItems, {
      config: {
        tier1: { systemPrompt: "Classify", confidenceThreshold: 0.7 },
        tier2: { prompt: "Reason: {{items}}" },
      },
      provider,
      onTier2,
    });

    const result = await pipeline.run();

    // Low confidence → needs-reasoning → Tier 2
    expect(result.tier2Escalated).toBe(2);
    expect(onTier2).toHaveBeenCalledOnce();
  });

  it("handles script failure gracefully (returns empty result)", async () => {
    const pipeline = new Pipeline({
      name: "fail",
      config: {
        tier0: {
          command: "false", // exits non-zero
          args: [],
          timeout: 5000,
        },
      },
      telemetry: { enabled: false, format: "json" },
    });

    const result = await pipeline.run();

    expect(result.tier0Items).toBe(0);
    expect(result.costEstimate).toBe(0);
  });

  it("emits telemetry events", async () => {
    const logSink = vi.fn();
    const pipeline = new Pipeline({
      name: "telemetry-test",
      config: makeConfig(),
      telemetry: { enabled: true, format: "json" },
      logSink,
    });

    await pipeline.run();

    expect(logSink).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tickle_stick.pipeline",
        pipeline: "telemetry-test",
        tier: 0,
      }),
    );
  });

  it("tracks metrics", async () => {
    const pipeline = makePipelineWithItems(sampleItems, {
      config: {
        tier1: { systemPrompt: "Classify", confidenceThreshold: 0.7 },
      },
      provider: mockProvider("routine", 0.9),
    });

    await pipeline.run();
    const metrics = pipeline.getMetrics();

    // Tier 0 event + 2 Tier 1 events
    expect(metrics.totalProcessed).toBe(3);
    expect(metrics.tierDistribution[0]).toBe(1);
    expect(metrics.tierDistribution[1]).toBe(2);
  });

  it("resets metrics", async () => {
    const pipeline = new Pipeline({
      name: "reset-test",
      config: makeConfig(),
      telemetry: { enabled: false, format: "json" },
    });

    await pipeline.run();
    pipeline.resetMetrics();

    expect(pipeline.getMetrics().totalProcessed).toBe(0);
  });

  it("substitutes {{items}} in Tier 2 prompt", async () => {
    const onTier2 = vi.fn().mockResolvedValue("done");
    const pipeline = makePipelineWithItems(sampleItems, {
      config: {
        tier2: { prompt: "Here are items: {{items}}" },
      },
      onTier2,
    });

    await pipeline.run();

    const [, prompt] = onTier2.mock.calls[0];
    expect(prompt).toContain("item-1");
    expect(prompt).toContain("item-2");
    expect(prompt).toContain("gmail");
    expect(prompt).toContain("Here are items:");
  });

  it("builds routine report from Tier 1 responses", async () => {
    const provider: TriageProvider = {
      name: "mock",
      classify: vi.fn().mockResolvedValue({
        classification: "routine",
        response: "Normal item",
        confidence: 0.9,
      }),
    };

    const pipeline = makePipelineWithItems(sampleItems, {
      config: {
        tier1: { systemPrompt: "Classify", confidenceThreshold: 0.7 },
      },
      provider,
    });

    const result = await pipeline.run();

    expect(result.routineReport).toBeDefined();
    expect(result.routineReport).toContain("Normal item");
    expect(result.routineReport).toContain("[gmail]");
    expect(result.routineReport).toContain("[calendar]");
  });
});
