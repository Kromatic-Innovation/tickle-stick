import * as fs from "node:fs";
import { describe, it, expect } from "vitest";
import { loadConfigFromString } from "../src/config/loader.js";
import { Pipeline } from "../src/pipeline.js";
import { missingBudgetRateKeys } from "../src/config/budget-rates.js";
import type { StageConfig } from "../src/config/schema.js";
import type { TriageProvider } from "../src/types.js";

// tickle-stick#248 (operator ruling 2026-11-15: fail closed): when a budget
// is configured, every cheap-model stage must set explicit per-token rates,
// at BOTH entry points (YAML loader and `new Pipeline(...)`).

function yamlConfig(opts: { budget: boolean; rates: string }): string {
  return [
    "tickleStick:",
    "  pipelines:",
    "    triage:",
    "      stages:",
    "        - name: classify",
    "          type: model",
    "          provider: cheap",
    "          systemPrompt: Classify this.",
    ...(opts.rates ? opts.rates.split("\n").map((l) => `          ${l}`) : []),
    "        - name: reason",
    "          type: model",
    "          provider: expensive",
    '          prompt: "Synthesize: {{items}}"',
    ...(opts.budget ? ["  budget:", "    maxDailySpend: 1.00"] : []),
    "",
  ].join("\n");
}

function loadError(yaml: string): string {
  try {
    loadConfigFromString(yaml);
  } catch (err) {
    // ZodError: read the human-readable issue messages, not the JSON dump.
    const issues = (err as { issues?: Array<{ message: string }> }).issues;
    return issues ? issues.map((i) => i.message).join("\n") : String(err);
  }
  throw new Error("expected loadConfigFromString to throw");
}

const provider: TriageProvider = {
  classify: () => Promise.resolve({ classification: "routine", confidence: 1 }),
};

function cheapStage(extra: Partial<StageConfig> = {}): StageConfig {
  return {
    name: "classify",
    type: "model",
    provider: "cheap",
    systemPrompt: "Classify",
    args: [],
    timeout: 30000,
    ...extra,
  };
}

describe("explicit per-token rates under a budget — config loader (tickle-stick#248)", () => {
  it("fails load when a budget is configured and a cheap stage sets no rates, naming both missing keys", () => {
    const msg = loadError(yamlConfig({ budget: true, rates: "" }));
    expect(msg).toContain('"costPerInputToken"');
    expect(msg).toContain('"costPerOutputToken"');
    expect(msg).toContain('stage "classify"');
    expect(msg).toContain("a budget is configured");
  });

  it("names only the missing key when one of the two rates is set", () => {
    const msg = loadError(
      yamlConfig({ budget: true, rates: "costPerInputToken: 0.000001" }),
    );
    expect(msg).toContain('"costPerOutputToken"');
    expect(msg).not.toContain('"costPerInputToken"');
  });

  it("loads when a budget is configured and both rates are set", () => {
    const config = loadConfigFromString(
      yamlConfig({
        budget: true,
        rates: "costPerInputToken: 0.000001\ncostPerOutputToken: 0.000005",
      }),
    );
    const stage = config.tickleStick.pipelines.triage.stages[0];
    expect(stage.costPerInputToken).toBe(0.000001);
    expect(stage.costPerOutputToken).toBe(0.000005);
  });

  it("accepts an explicit zero rate (a free/self-hosted model) as set", () => {
    expect(() =>
      loadConfigFromString(
        yamlConfig({
          budget: true,
          rates: "costPerInputToken: 0\ncostPerOutputToken: 0",
        }),
      ),
    ).not.toThrow();
  });

  it("does not require rates when no budget is configured (telemetry estimates only)", () => {
    expect(() =>
      loadConfigFromString(yamlConfig({ budget: false, rates: "" })),
    ).not.toThrow();
  });

  it("treats an empty budget block as a configured budget", () => {
    const yaml = yamlConfig({ budget: false, rates: "" }) + "  budget: {}\n";
    expect(loadError(yaml)).toContain('"costPerInputToken"');
  });
});

describe("explicit per-token rates under a budget — new Pipeline(...) (tickle-stick#248)", () => {
  it("throws at construction when budgetConfig is passed and a cheap stage sets no rates", () => {
    expect(
      () =>
        new Pipeline({
          name: "programmatic",
          config: { stages: [cheapStage()] },
          telemetry: { enabled: false, format: "json" },
          triageProvider: provider,
          budgetConfig: { maxDailySpend: 1, alerts: [], retentionDays: 30 },
        }),
    ).toThrow(
      /Pipeline "programmatic" stage "classify".*"costPerInputToken" and "costPerOutputToken"/,
    );
  });

  it("constructs when budgetConfig is passed and both rates are set", () => {
    expect(
      () =>
        new Pipeline({
          name: "programmatic",
          config: {
            stages: [
              cheapStage({
                costPerInputToken: 0.000001,
                costPerOutputToken: 0.000005,
              }),
            ],
          },
          telemetry: { enabled: false, format: "json" },
          triageProvider: provider,
          budgetConfig: { maxDailySpend: 1, alerts: [], retentionDays: 30 },
        }),
    ).not.toThrow();
  });

  it("constructs without rates when no budgetConfig is passed", () => {
    expect(
      () =>
        new Pipeline({
          name: "programmatic",
          config: { stages: [cheapStage()] },
          telemetry: { enabled: false, format: "json" },
          triageProvider: provider,
        }),
    ).not.toThrow();
  });

  it("agrees with the loader: the same missing keys are reported for the same stage", () => {
    expect(missingBudgetRateKeys(cheapStage())).toEqual([
      "costPerInputToken",
      "costPerOutputToken",
    ]);
    expect(
      missingBudgetRateKeys({ name: "r", type: "model", provider: "expensive" }),
    ).toEqual([]);
    expect(missingBudgetRateKeys({ name: "s", type: "script" })).toEqual([]);
  });
});

describe("no vendor-labelled default rates remain (tickle-stick#248)", () => {
  it.each(["src/tiers/tier1-triage.ts", "src/config/schema.ts"])(
    "%s no longer claims its defaults match a vendor model",
    (file) => {
      const text = fs.readFileSync(file, "utf-8");
      expect(text).not.toMatch(/Haiku 3\.5|4o-mini/);
    },
  );
});
