import { describe, it, expect, vi } from "vitest";
import { Pipeline } from "../src/pipeline.js";
import type { PipelineConfigEntry, StageConfig } from "../src/config/schema.js";
import type { WorkItem, TriageProvider, StageResult } from "../src/types.js";

const sampleItems: WorkItem[] = [
  {
    id: "item-1",
    source: "gmail",
    type: "email",
    summary: "Important meeting",
    timestamp: new Date(),
  },
  {
    id: "item-2",
    source: "gmail",
    type: "email",
    summary: "Newsletter spam",
    timestamp: new Date(),
  },
  {
    id: "item-3",
    source: "calendar",
    type: "event",
    summary: "Dentist appointment",
    timestamp: new Date(),
  },
];

function scriptStageForItems(items: WorkItem[]): StageConfig {
  const json = JSON.stringify(
    items.map((i) => ({ ...i, timestamp: i.timestamp.toISOString() })),
  );
  return {
    name: "gather",
    type: "script",
    command: "node",
    args: ["-e", `process.stdout.write(${JSON.stringify(json)})`],
    timeout: 5000,
  };
}

function mockProvider(classifyFn?: TriageProvider["classify"]): TriageProvider {
  return {
    name: "mock",
    classify:
      classifyFn ??
      vi.fn().mockResolvedValue({
        classification: "routine",
        response: "Routine item",
        confidence: 0.95,
      }),
  };
}

describe("Multi-stage pipeline", () => {
  it("executes script → cheap model → expensive model → callback", async () => {
    const classifyFn = vi.fn().mockImplementation(async (text: string) => {
      if (text.includes("spam")) {
        return { classification: "routine", confidence: 0.99 };
      }
      return { classification: "needs-reasoning", confidence: 0.85 };
    });

    const stageCallbacks = {
      reason: vi.fn().mockResolvedValue("Reasoning output"),
      deliver: vi.fn().mockResolvedValue("Delivered"),
    };

    const pipeline = new Pipeline({
      name: "multi-stage",
      config: {
        stages: [
          scriptStageForItems(sampleItems),
          {
            name: "classify",
            type: "model",
            provider: "cheap",
            systemPrompt: "Classify",
            confidenceThreshold: 0.7,
          },
          {
            name: "reason",
            type: "model",
            provider: "expensive",
            prompt: "Reason about: {{items}}",
            input: "classified:needs-reasoning",
          },
          {
            name: "deliver",
            type: "callback",
            input: "all",
          },
        ],
      },
      telemetry: { enabled: false, format: "json" },
      triageProvider: mockProvider(classifyFn),
      stageCallbacks,
    });

    const result = await pipeline.run();

    expect(result.stageResults).toHaveLength(4);
    expect(result.totalItems).toBe(3);

    // Classify stage: 3 items classified
    const classifyResult = result.stageResults[1];
    expect(classifyResult.name).toBe("classify");
    expect(classifyResult.items).toHaveLength(3);

    // Reason stage: only needs-reasoning items
    expect(stageCallbacks.reason).toHaveBeenCalledOnce();
    const [reasonItems] = stageCallbacks.reason.mock.calls[0];
    expect(reasonItems).toHaveLength(2); // "Important meeting" + "Dentist"

    // Deliver stage: called with all items
    expect(stageCallbacks.deliver).toHaveBeenCalledOnce();
  });

  it("filters input with classified:routine", async () => {
    const stageCallbacks = {
      summarize: vi.fn().mockResolvedValue("Summary"),
    };

    const pipeline = new Pipeline({
      name: "filter-test",
      config: {
        stages: [
          scriptStageForItems(sampleItems),
          {
            name: "classify",
            type: "model",
            provider: "cheap",
            systemPrompt: "Classify",
            confidenceThreshold: 0.7,
          },
          {
            name: "summarize",
            type: "model",
            provider: "expensive",
            prompt: "Summarize routine: {{items}}",
            input: "classified:routine",
          },
        ],
      },
      telemetry: { enabled: false, format: "json" },
      triageProvider: mockProvider(),
      stageCallbacks,
    });

    const result = await pipeline.run();

    // All items classified as routine → all go to summarize
    const [items] = stageCallbacks.summarize.mock.calls[0];
    expect(items).toHaveLength(3);
  });

  it("filters with comma-separated classifications", async () => {
    const classifyFn = vi.fn().mockImplementation(async (text: string) => {
      if (text.includes("spam"))
        return { classification: "routine", confidence: 0.99 };
      if (text.includes("Important"))
        return { classification: "urgent", confidence: 0.9 };
      return { classification: "needs-reasoning", confidence: 0.8 };
    });

    const stageCallbacks = {
      process: vi.fn().mockResolvedValue("Done"),
    };

    const pipeline = new Pipeline({
      name: "comma-filter",
      config: {
        stages: [
          scriptStageForItems(sampleItems),
          {
            name: "classify",
            type: "model",
            provider: "cheap",
            systemPrompt: "Classify",
            confidenceThreshold: 0.7,
          },
          {
            name: "process",
            type: "model",
            provider: "expensive",
            prompt: "Process: {{items}}",
            input: "classified:urgent,classified:needs-reasoning",
          },
        ],
      },
      telemetry: { enabled: false, format: "json" },
      triageProvider: mockProvider(classifyFn),
      stageCallbacks,
    });

    await pipeline.run();

    // "Important" = urgent, "Dentist" = needs-reasoning, "spam" = routine (filtered out)
    const [items] = stageCallbacks.process.mock.calls[0];
    expect(items).toHaveLength(2);
  });

  it("substitutes {{all_items}} in prompt", async () => {
    const classifyFn = vi.fn().mockResolvedValue({
      classification: "needs-reasoning",
      confidence: 0.9,
    });

    const stageCallbacks = {
      synthesize: vi.fn().mockResolvedValue("Briefing"),
    };

    const pipeline = new Pipeline({
      name: "all-items-test",
      config: {
        stages: [
          scriptStageForItems(sampleItems),
          {
            name: "classify",
            type: "model",
            provider: "cheap",
            systemPrompt: "Classify",
            confidenceThreshold: 0.7,
          },
          {
            name: "synthesize",
            type: "model",
            provider: "expensive",
            prompt: "All: {{all_items}} Filtered: {{items}}",
            input: "classified:needs-reasoning",
          },
        ],
      },
      telemetry: { enabled: false, format: "json" },
      triageProvider: mockProvider(classifyFn),
      stageCallbacks,
    });

    await pipeline.run();

    const [, prompt] = stageCallbacks.synthesize.mock.calls[0];
    // Both {{all_items}} and {{items}} should contain all 3 items
    expect(prompt).toContain("item-1");
    expect(prompt).toContain("item-2");
    expect(prompt).toContain("item-3");
  });

  it("runs post-hook after stage completion", async () => {
    // Use a post-hook that writes to a file we can check
    // For testing, we use a no-op command that succeeds
    const pipeline = new Pipeline({
      name: "posthook-test",
      config: {
        stages: [
          scriptStageForItems(sampleItems),
          {
            name: "classify",
            type: "model",
            provider: "cheap",
            systemPrompt: "Classify",
            confidenceThreshold: 0.7,
            postHook: {
              command: "node",
              args: [
                "-e",
                "process.stdin.resume(); process.stdin.on('data', () => {}); process.stdin.on('end', () => process.exit(0))",
              ],
              timeout: 5000,
            },
          },
        ],
      },
      telemetry: { enabled: false, format: "json" },
      triageProvider: mockProvider(),
    });

    // Should not throw — post-hook runs successfully
    const result = await pipeline.run();
    expect(result.stageResults).toHaveLength(2);
  });

  it("continues pipeline when post-hook fails", async () => {
    const stageCallbacks = {
      reason: vi.fn().mockResolvedValue("Still works"),
    };

    const pipeline = new Pipeline({
      name: "posthook-fail",
      config: {
        stages: [
          scriptStageForItems(sampleItems),
          {
            name: "classify",
            type: "model",
            provider: "cheap",
            systemPrompt: "Classify",
            confidenceThreshold: 0.7,
            postHook: {
              command: "false", // exits non-zero
              timeout: 5000,
            },
          },
          {
            name: "reason",
            type: "model",
            provider: "expensive",
            prompt: "Process: {{items}}",
          },
        ],
      },
      telemetry: { enabled: false, format: "json" },
      triageProvider: mockProvider(),
      stageCallbacks,
    });

    const result = await pipeline.run();

    // Pipeline continues despite post-hook failure
    expect(result.stageResults).toHaveLength(3);
    expect(stageCallbacks.reason).toHaveBeenCalledOnce();
  });

  it("tracks per-stage results", async () => {
    const stageCallbacks = {
      reason: vi.fn().mockResolvedValue("Analysis"),
    };

    const pipeline = new Pipeline({
      name: "stage-results",
      config: {
        stages: [
          scriptStageForItems(sampleItems),
          {
            name: "classify",
            type: "model",
            provider: "cheap",
            systemPrompt: "Classify",
            confidenceThreshold: 0.7,
          },
          {
            name: "reason",
            type: "model",
            provider: "expensive",
            prompt: "Analyze: {{items}}",
          },
        ],
      },
      telemetry: { enabled: false, format: "json" },
      triageProvider: mockProvider(),
      stageCallbacks,
    });

    const result = await pipeline.run();

    expect(result.stageResults).toHaveLength(3);

    // Gather stage
    expect(result.stageResults[0].name).toBe("gather");
    expect(result.stageResults[0].type).toBe("script");
    expect(result.stageResults[0].items).toHaveLength(3);

    // Classify stage
    expect(result.stageResults[1].name).toBe("classify");
    expect(result.stageResults[1].type).toBe("model");
    expect(result.stageResults[1].costEstimate).toBeGreaterThan(0);

    // Reason stage
    expect(result.stageResults[2].name).toBe("reason");
    expect(result.stageResults[2].output).toBe("Analysis");
  });

  it("calls onStageComplete for each stage", async () => {
    const onStageComplete = vi.fn();

    const pipeline = new Pipeline({
      name: "callback-test",
      config: {
        stages: [
          scriptStageForItems(sampleItems),
          {
            name: "classify",
            type: "model",
            provider: "cheap",
            systemPrompt: "Classify",
            confidenceThreshold: 0.7,
          },
        ],
      },
      telemetry: { enabled: false, format: "json" },
      triageProvider: mockProvider(),
      onStageComplete,
    });

    await pipeline.run();

    expect(onStageComplete).toHaveBeenCalledTimes(2);
    expect(onStageComplete).toHaveBeenCalledWith(
      "gather",
      expect.objectContaining({ name: "gather" }),
    );
    expect(onStageComplete).toHaveBeenCalledWith(
      "classify",
      expect.objectContaining({ name: "classify" }),
    );
  });

  it("skips expensive model stage when no callback registered", async () => {
    const pipeline = new Pipeline({
      name: "no-callback",
      config: {
        stages: [
          scriptStageForItems(sampleItems),
          {
            name: "reason",
            type: "model",
            provider: "expensive",
            prompt: "Analyze: {{items}}",
          },
        ],
      },
      telemetry: { enabled: false, format: "json" },
      // No stageCallbacks
    });

    const result = await pipeline.run();

    // Stage runs but produces no output
    const reasonStage = result.stageResults.find((s) => s.name === "reason");
    expect(reasonStage).toBeDefined();
    expect(reasonStage?.output).toBeUndefined();
  });

  it("skips callback stage when no callback registered", async () => {
    const pipeline = new Pipeline({
      name: "no-callback",
      config: {
        stages: [
          scriptStageForItems(sampleItems),
          {
            name: "deliver",
            type: "callback",
          },
        ],
      },
      telemetry: { enabled: false, format: "json" },
      // No stageCallbacks
    });

    const result = await pipeline.run();

    expect(result.stageResults).toHaveLength(2);
  });

  it("early-exits when first script stage returns no items", async () => {
    const stageCallbacks = {
      reason: vi.fn().mockResolvedValue("Should not run"),
    };

    const pipeline = new Pipeline({
      name: "early-exit",
      config: {
        stages: [
          {
            name: "gather",
            type: "script",
            command: "echo",
            args: ["[]"],
            timeout: 5000,
          },
          {
            name: "reason",
            type: "model",
            provider: "expensive",
            prompt: "Process: {{items}}",
          },
        ],
      },
      telemetry: { enabled: false, format: "json" },
      stageCallbacks,
    });

    const result = await pipeline.run();

    expect(result.totalItems).toBe(0);
    expect(result.stageResults).toHaveLength(1); // Only gather stage
    expect(stageCallbacks.reason).not.toHaveBeenCalled();
  });
});
