import { describe, it, expect, vi } from "vitest";
import { Pipeline } from "../src/pipeline.js";
import type { StageConfig } from "../src/config/schema.js";
import type { WorkItem, TriageProvider, StorageAdapter } from "../src/types.js";

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

    await pipeline.run();

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

  it("substitutes repeated {{items}} placeholders (P1-#2)", async () => {
    const classifyFn = vi.fn().mockResolvedValue({
      classification: "needs-reasoning",
      confidence: 0.9,
    });
    const stageCallbacks = { reason: vi.fn().mockResolvedValue("ok") };

    const pipeline = new Pipeline({
      name: "repeat-placeholder",
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
            prompt: "First: {{items}} --- Again: {{items}}",
            input: "classified:needs-reasoning",
          },
        ],
      },
      telemetry: { enabled: false, format: "json" },
      triageProvider: mockProvider(classifyFn),
      stageCallbacks,
    });

    await pipeline.run();

    const [, prompt] = stageCallbacks.reason.mock.calls[0];
    // Both occurrences are substituted — no literal placeholder survives,
    // and item-1 appears in each of the two rendered blocks.
    expect(prompt).not.toContain("{{items}}");
    expect(prompt.split("item-1").length - 1).toBe(2);
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

  it("surfaces script-stage failures via onError and marks the stage errored (P2-#4)", async () => {
    const onError = vi.fn();

    const pipeline = new Pipeline({
      name: "script-fail",
      config: {
        stages: [
          { name: "gather", type: "script", command: "false", args: [], timeout: 5000 },
        ],
      },
      telemetry: { enabled: false, format: "json" },
      onError,
    });

    const result = await pipeline.run();

    // A failed gather still yields zero items — but is no longer
    // indistinguishable from a legitimately empty one.
    expect(result.totalItems).toBe(0);
    expect(result.stageResults[0].errored).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    const [stageName, err, phase] = onError.mock.calls[0];
    expect(stageName).toBe("gather");
    expect(err).toBeInstanceOf(Error);
    expect(phase).toBe("stage");
  });

  it("does not mark a legitimately empty script stage as errored (P2-#4)", async () => {
    const onError = vi.fn();

    const pipeline = new Pipeline({
      name: "script-empty",
      config: {
        stages: [
          { name: "gather", type: "script", command: "echo", args: ["[]"], timeout: 5000 },
        ],
      },
      telemetry: { enabled: false, format: "json" },
      onError,
    });

    const result = await pipeline.run();

    expect(result.totalItems).toBe(0);
    expect(result.stageResults[0].errored).toBeFalsy();
    expect(onError).not.toHaveBeenCalled();
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

describe("Budget cap re-evaluation at the pipeline level (tickle-stick#240)", () => {
  function classifyStage(): StageConfig {
    return {
      name: "classify",
      type: "model",
      provider: "cheap",
      systemPrompt: "Classify",
      confidenceThreshold: 0.7,
    };
  }

  it("gates the first run of a fresh Pipeline whose storage already shows spend over the cap (AC1/AC4)", async () => {
    const storage: StorageAdapter = {
      writeEvent: vi.fn(),
      // Storage already reports spend over the cap before this Pipeline
      // instance has ever recorded a costed event itself.
      getSpendSince: vi.fn().mockResolvedValue(5),
      prune: vi.fn().mockResolvedValue(0),
    };
    const classifyFn = vi.fn().mockResolvedValue({
      classification: "routine",
      confidence: 0.95,
    });

    const pipeline = new Pipeline({
      name: "fresh-over-cap",
      config: { stages: [scriptStageForItems(sampleItems), classifyStage()] },
      telemetry: { enabled: false, format: "json" },
      triageProvider: mockProvider(classifyFn),
      storage,
      budgetConfig: { maxDailySpend: 1, alerts: [], retentionDays: 30 },
    });

    const result = await pipeline.run();
    const classifyResult = result.stageResults[1];

    expect(classifyResult.items).toHaveLength(0);
    expect(classifyFn).not.toHaveBeenCalled();
  });

  it("clears the cap latch on a later run once window spend drops, with no costed event on this instance in between (AC2/AC4)", async () => {
    const events: { timestamp: string; costEstimate: number }[] = [];
    const storage: StorageAdapter = {
      writeEvent: vi.fn((event) => {
        events.push(event as { timestamp: string; costEstimate: number });
      }),
      getSpendSince: vi.fn((since: string) =>
        events
          .filter((e) => e.timestamp >= since)
          .reduce((sum, e) => sum + e.costEstimate, 0),
      ),
      prune: vi.fn().mockResolvedValue(0),
    };
    const classifyFn = vi.fn().mockResolvedValue({
      classification: "routine",
      confidence: 0.95,
    });

    // 3 sample items at the $0.001 default cost estimate; cap trips partway
    // through the first run.
    const pipeline = new Pipeline({
      name: "long-lived",
      config: { stages: [scriptStageForItems(sampleItems), classifyStage()] },
      telemetry: { enabled: false, format: "json" },
      triageProvider: mockProvider(classifyFn),
      storage,
      budgetConfig: { maxDailySpend: 0.002, alerts: [], retentionDays: 30 },
    });

    await pipeline.run();
    // Let the fire-and-forget record() from the final item's emit settle
    // (same pattern as test/budget.test.ts's prune-microtask wait).
    await new Promise((r) => setTimeout(r, 0));
    expect(pipeline.isBudgetExceeded()).toBe(true);

    // Window spend drops back to 0 (e.g. day rollover) without this
    // Pipeline instance recording any further costed event.
    events.length = 0;
    classifyFn.mockClear();

    const run2 = await pipeline.run();
    const classifyResult = run2.stageResults[1];

    expect(classifyResult.items.length).toBeGreaterThan(0);
    expect(classifyFn).toHaveBeenCalled();
  });

  it("bounds a cheap-tier stage's overshoot to the recheck cadence instead of its whole item count (AC3)", async () => {
    const items: WorkItem[] = Array.from({ length: 25 }, (_, i) => ({
      id: `item-${i}`,
      source: "gmail",
      type: "email",
      summary: `Message ${i}`,
      timestamp: new Date(),
    }));

    let externalSpend = 0;
    const storage: StorageAdapter = {
      writeEvent: vi.fn(),
      getSpendSince: vi.fn(() => externalSpend),
      prune: vi.fn().mockResolvedValue(0),
    };

    let calls = 0;
    const classifyFn = vi.fn().mockImplementation(async () => {
      calls += 1;
      // Simulate a sibling process/stage spending the budget mid-batch,
      // without going through this Pipeline's own record() path — the
      // per-item cached read can only catch this on the bounded refresh
      // cadence, not immediately.
      if (calls === 13) externalSpend = 2;
      return { classification: "routine", confidence: 0.95 };
    });

    const pipeline = new Pipeline({
      name: "bounded-overshoot",
      config: { stages: [scriptStageForItems(items), classifyStage()] },
      telemetry: { enabled: false, format: "json" },
      triageProvider: mockProvider(classifyFn),
      storage,
      budgetConfig: { maxDailySpend: 1, alerts: [], retentionDays: 30 },
    });

    const result = await pipeline.run();
    const classifyResult = result.stageResults[1];

    // Bounded by the recheck cadence, not by the stage's whole 25-item
    // input: the loop must stop well short of processing every item.
    expect(classifyResult.items.length).toBeLessThan(items.length);
    expect(classifyResult.items.length).toBeLessThanOrEqual(20);
  });

  it("tolerates a throwing storage adapter at refresh() time: run() still resolves and reports via onError (Seer finding 1)", async () => {
    const storage: StorageAdapter = {
      writeEvent: vi.fn(),
      getSpendSince: vi.fn().mockRejectedValue(new Error("storage is down")),
      prune: vi.fn().mockResolvedValue(0),
    };
    const onError = vi.fn();
    const classifyFn = vi.fn().mockResolvedValue({
      classification: "routine",
      confidence: 0.95,
    });

    const pipeline = new Pipeline({
      name: "throwing-storage",
      config: { stages: [scriptStageForItems(sampleItems), classifyStage()] },
      telemetry: { enabled: false, format: "json" },
      triageProvider: mockProvider(classifyFn),
      storage,
      budgetConfig: { maxDailySpend: 1, alerts: [], retentionDays: 30 },
      onError,
    });

    // The failing refresh() at the top of run() must not reject run()
    // itself -- it must be reported and tolerated, same contract as any
    // other storage/hook failure in this class.
    const result = await pipeline.run();

    expect(result.totalItems).toBe(sampleItems.length);
    expect(onError).toHaveBeenCalledWith(
      "budget-record",
      expect.any(Error),
      "post-hook",
    );
  });

  it("does not discard already-classified items when a periodic refresh() throws mid-loop (Seer finding 1)", async () => {
    const items: WorkItem[] = Array.from({ length: 25 }, (_, i) => ({
      id: `item-${i}`,
      source: "gmail",
      type: "email",
      summary: `Message ${i}`,
      timestamp: new Date(),
    }));

    let calls = 0;
    const storage: StorageAdapter = {
      writeEvent: vi.fn(),
      getSpendSince: vi.fn(() => {
        calls += 1;
        // Calls 1-2 are Pipeline.run()'s start-of-run refresh (day +
        // week) and must succeed so the stage is allowed to start.
        // Every call after that is the cheap-tier loop's own periodic
        // refresh, which this test makes fail every time it runs, to
        // prove that failure is bookkeeping-only.
        if (calls <= 2) return 0;
        throw new Error("storage is down");
      }),
      prune: vi.fn().mockResolvedValue(0),
    };

    const onError = vi.fn();
    const classifyFn = vi.fn().mockResolvedValue({
      classification: "routine",
      confidence: 0.95,
      // Zero token usage -> zero costEstimate -> emit() never calls
      // budgetManager.record() for these items, so the getSpendSince
      // call count above stays deterministic (driven only by the
      // start-of-run refresh and the loop's own periodic refresh).
      tokenUsage: { input: 0, output: 0 },
    });

    const pipeline = new Pipeline({
      name: "refresh-throws-mid-loop",
      config: { stages: [scriptStageForItems(items), classifyStage()] },
      telemetry: { enabled: false, format: "json" },
      triageProvider: mockProvider(classifyFn),
      storage,
      budgetConfig: { maxDailySpend: 1, alerts: [], retentionDays: 30 },
      onError,
    });

    const result = await pipeline.run();
    const classifyResult = result.stageResults[1];

    // Every item is still classified: a refresh() throw mid-loop must not
    // abort the stage body and discard the items already classified
    // before (or after) it -- context.classified.push() still runs.
    expect(classifyResult.items).toHaveLength(items.length);
    expect(classifyFn).toHaveBeenCalledTimes(items.length);
    expect(onError).toHaveBeenCalledWith(
      "classify",
      expect.any(Error),
      "stage",
    );
  });
});

describe("Budget-cap model-stage skip (tickle-stick#241, operator ruling D2)", () => {
  // Discharges AC4/AC5 ("probe P3 re-run") as tests — the operator-local
  // audit corpus referenced by the issue is unreachable from this
  // container. This reproduces the same shape: a cheap "classify" stage
  // and an expensive "reason" stage both run while the budget cap is
  // already tripped, followed by a callback stage with `input: "all"`.
  it("skips every model stage, keeps items in context for the input:\"all\" callback, emits a budget-reason telemetry event, and calls onError once per skipped stage", async () => {
    const twoItems = sampleItems.slice(0, 2);
    const storage: StorageAdapter = {
      writeEvent: vi.fn(),
      // Storage already reports spend over the cap before this Pipeline
      // instance has ever recorded a costed event itself (same pattern as
      // the tickle-stick#240 "fresh Pipeline over cap" test above).
      getSpendSince: vi.fn().mockResolvedValue(5),
      prune: vi.fn().mockResolvedValue(0),
    };
    const classifyFn = vi
      .fn()
      .mockResolvedValue({ classification: "routine", confidence: 0.95 });
    const stageCallbacks = {
      reason: vi.fn().mockResolvedValue("should not run"),
      deliver: vi.fn().mockResolvedValue("delivered"),
    };
    const onError = vi.fn();
    const events: Array<Record<string, unknown>> = [];

    const pipeline = new Pipeline({
      name: "budget-skip",
      config: {
        stages: [
          scriptStageForItems(twoItems),
          {
            name: "classify",
            type: "model",
            provider: "cheap",
            systemPrompt: "Classify",
          },
          {
            name: "reason",
            type: "model",
            provider: "expensive",
            prompt: "Reason: {{items}}",
          },
          {
            name: "deliver",
            type: "callback",
            input: "all",
          },
        ],
      },
      telemetry: { enabled: true, format: "json" },
      logSink: (e) => events.push(e as unknown as Record<string, unknown>),
      triageProvider: mockProvider(classifyFn),
      stageCallbacks,
      storage,
      budgetConfig: { maxDailySpend: 1, alerts: [], retentionDays: 30 },
      onError,
    });

    const result = await pipeline.run();

    // Both model stages are skipped entirely — the cheap classifier never
    // runs and the expensive callback never fires.
    expect(classifyFn).not.toHaveBeenCalled();
    expect(stageCallbacks.reason).not.toHaveBeenCalled();
    const classifyResult = result.stageResults.find(
      (s) => s.name === "classify",
    );
    const reasonResult = result.stageResults.find((s) => s.name === "reason");
    expect(classifyResult?.items).toHaveLength(0);
    expect(classifyResult?.errored).toBe(true);
    expect(reasonResult?.errored).toBe(true);

    // The callback stage with input: "all" still receives both items — they
    // were never removed from context, only never classified.
    expect(stageCallbacks.deliver).toHaveBeenCalledOnce();
    const [deliverItems] = stageCallbacks.deliver.mock.calls[0];
    expect(deliverItems).toHaveLength(2);

    // A budget-reason telemetry event fires once per skipped model stage.
    const budgetEvents = events.filter(
      (e) =>
        (e.metadata as Record<string, unknown> | undefined)?.reason ===
        "budget",
    );
    expect(budgetEvents).toHaveLength(2);
    expect(
      budgetEvents.map((e) => (e.metadata as Record<string, unknown>).stage),
    ).toEqual(["classify", "reason"]);

    // onError fires exactly once per skipped stage.
    const skipErrorCalls = onError.mock.calls.filter(([stageName]) =>
      ["classify", "reason"].includes(stageName as string),
    );
    expect(skipErrorCalls).toHaveLength(2);
  });
});
