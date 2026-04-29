import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfigFromString } from "../src/config/loader.js";
import { tickleStickConfigSchema } from "../src/config/schema.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";

describe("Config Schema", () => {
  it("validates a minimal config", () => {
    const result = tickleStickConfigSchema.parse({
      tickleStick: {},
    });

    expect(result.tickleStick.pipelines).toEqual({});
    expect(result.tickleStick.telemetry.enabled).toBe(true);
  });

  it("validates a config with stages-based pipeline", () => {
    const result = tickleStickConfigSchema.parse({
      tickleStick: {
        pipelines: {
          "daily-briefing": {
            stages: [
              {
                name: "gather",
                type: "script",
                command: "python3",
                args: ["scripts/fetch-daily.py"],
                timeout: 30000,
              },
              {
                name: "classify",
                type: "model",
                provider: "cheap",
                systemPrompt: "Classify this.",
                confidenceThreshold: 0.8,
              },
              {
                name: "reason",
                type: "model",
                provider: "expensive",
                prompt: "Synthesize: {{items}}",
                input: "classified:needs-reasoning",
              },
              {
                name: "deliver",
                type: "callback",
              },
            ],
          },
        },
        telemetry: {
          enabled: true,
          format: "json",
        },
        budget: {
          maxDailySpend: 1.0,
          maxWeeklySpend: 5.0,
          alerts: [{ at: "80%" }, { at: 0.5 }],
          retentionDays: 30,
        },
      },
    });

    const pipeline = result.tickleStick.pipelines["daily-briefing"];
    expect(pipeline.stages).toHaveLength(4);
    expect(pipeline.stages[0].command).toBe("python3");
    expect(pipeline.stages[1].confidenceThreshold).toBe(0.8);
    expect(pipeline.stages[2].prompt).toContain("{{items}}");
    expect(pipeline.stages[3].type).toBe("callback");
    expect(result.tickleStick.budget!.maxDailySpend).toBe(1.0);
  });

  it("applies defaults for optional fields", () => {
    const result = tickleStickConfigSchema.parse({
      tickleStick: {
        pipelines: {
          test: {
            stages: [
              {
                name: "gather",
                type: "script",
                command: "echo",
                args: ["[]"],
              },
              {
                name: "classify",
                type: "model",
                provider: "cheap",
                systemPrompt: "Test",
              },
            ],
          },
        },
      },
    });

    const pipeline = result.tickleStick.pipelines["test"];
    expect(pipeline.stages[0].timeout).toBe(30000);
    expect(result.tickleStick.telemetry.format).toBe("json");
  });

  it("rejects invalid confidence threshold", () => {
    expect(() =>
      tickleStickConfigSchema.parse({
        tickleStick: {
          pipelines: {
            test: {
              stages: [
                {
                  name: "classify",
                  type: "model",
                  provider: "cheap",
                  systemPrompt: "test",
                  confidenceThreshold: 1.5,
                },
              ],
            },
          },
        },
      }),
    ).toThrow();
  });

  it("requires at least one stage in pipeline", () => {
    expect(() =>
      tickleStickConfigSchema.parse({
        tickleStick: {
          pipelines: {
            test: {
              stages: [],
            },
          },
        },
      }),
    ).toThrow();
  });

  it("validates stage types", () => {
    expect(() =>
      tickleStickConfigSchema.parse({
        tickleStick: {
          pipelines: {
            test: {
              stages: [
                {
                  name: "bad",
                  type: "invalid",
                },
              ],
            },
          },
        },
      }),
    ).toThrow();
  });

  it("validates post-hook config", () => {
    const result = tickleStickConfigSchema.parse({
      tickleStick: {
        pipelines: {
          test: {
            stages: [
              {
                name: "classify",
                type: "model",
                provider: "cheap",
                systemPrompt: "Test",
                postHook: {
                  command: "python3",
                  args: ["apply-labels.py"],
                  timeout: 10000,
                },
              },
            ],
          },
        },
      },
    });

    const hook = result.tickleStick.pipelines["test"].stages[0].postHook;
    expect(hook!.command).toBe("python3");
    expect(hook!.args).toEqual(["apply-labels.py"]);
    expect(hook!.timeout).toBe(10000);
  });

  it("applies post-hook defaults", () => {
    const result = tickleStickConfigSchema.parse({
      tickleStick: {
        pipelines: {
          test: {
            stages: [
              {
                name: "classify",
                type: "model",
                provider: "cheap",
                systemPrompt: "Test",
                postHook: {
                  command: "python3",
                },
              },
            ],
          },
        },
      },
    });

    const hook = result.tickleStick.pipelines["test"].stages[0].postHook;
    expect(hook!.args).toEqual([]);
    expect(hook!.timeout).toBe(15000);
  });

  it("validates input filter field", () => {
    const result = tickleStickConfigSchema.parse({
      tickleStick: {
        pipelines: {
          test: {
            stages: [
              {
                name: "reason",
                type: "model",
                provider: "expensive",
                prompt: "Analyze: {{items}}",
                input: "classified:needs-reasoning,classified:urgent",
              },
            ],
          },
        },
      },
    });

    expect(result.tickleStick.pipelines["test"].stages[0].input).toBe(
      "classified:needs-reasoning,classified:urgent",
    );
  });
});

describe("Config Loader", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("parses YAML string with stages config", () => {
    const yaml = `
tickleStick:
  pipelines:
    email-check:
      stages:
        - name: gather
          type: script
          command: "python3"
          args: ["check-email.py"]
`;
    const config = loadConfigFromString(yaml);
    const pipeline = config.tickleStick.pipelines["email-check"];
    expect(pipeline.stages[0].command).toBe("python3");
    expect(pipeline.stages[0].args).toEqual(["check-email.py"]);
  });

  it("interpolates environment variables", () => {
    process.env.SCRIPT_PATH = "custom/script.py";

    const yaml = `
tickleStick:
  pipelines:
    test:
      stages:
        - name: gather
          type: script
          command: "python3"
          args: ["\${SCRIPT_PATH}"]
`;
    const config = loadConfigFromString(yaml);
    expect(config.tickleStick.pipelines["test"].stages[0].args[0]).toBe(
      "custom/script.py",
    );
  });

  it("replaces missing env vars with empty string", () => {
    delete process.env.NONEXISTENT_VAR;

    const yaml = `
tickleStick:
  pipelines:
    test:
      stages:
        - name: gather
          type: script
          command: "\${NONEXISTENT_VAR}"
`;
    const config = loadConfigFromString(yaml);
    expect(config.tickleStick.pipelines["test"].stages[0].command).toBe("");
  });
});

describe("File References ($file:)", () => {
  const fixturesDir = path.resolve(__dirname, "fixtures");

  it("resolves $file: references in prompt fields", () => {
    const yaml = `
tickleStick:
  pipelines:
    test:
      stages:
        - name: classify
          type: model
          provider: cheap
          systemPrompt: "$file:test-prompt.md"
`;
    const config = loadConfigFromString(yaml, fixturesDir);
    const prompt = config.tickleStick.pipelines["test"].stages[0].systemPrompt;
    expect(prompt).toContain("Classify each item as JSON:");
    expect(prompt).toContain('"classification": "routine"');
  });

  it("throws on missing file reference", () => {
    const yaml = `
tickleStick:
  pipelines:
    test:
      stages:
        - name: classify
          type: model
          provider: cheap
          systemPrompt: "$file:nonexistent.md"
`;
    expect(() => loadConfigFromString(yaml, fixturesDir)).toThrow(
      /File reference not found/,
    );
  });

  it("leaves non-$file strings unchanged", () => {
    const yaml = `
tickleStick:
  pipelines:
    test:
      stages:
        - name: classify
          type: model
          provider: cheap
          systemPrompt: "Inline prompt text"
`;
    const config = loadConfigFromString(yaml, fixturesDir);
    expect(config.tickleStick.pipelines["test"].stages[0].systemPrompt).toBe(
      "Inline prompt text",
    );
  });

  it("resolves $file: in nested array elements", () => {
    const yaml = `
tickleStick:
  pipelines:
    test:
      stages:
        - name: gather
          type: script
          command: "echo"
          args: ["$file:test-prompt.md"]
`;
    const config = loadConfigFromString(yaml, fixturesDir);
    expect(config.tickleStick.pipelines["test"].stages[0].args[0]).toContain(
      "Classify each item",
    );
  });

  it("skips file resolution when no basePath provided", () => {
    const yaml = `
tickleStick:
  pipelines:
    test:
      stages:
        - name: classify
          type: model
          provider: cheap
          systemPrompt: "$file:test-prompt.md"
`;
    const config = loadConfigFromString(yaml);
    expect(config.tickleStick.pipelines["test"].stages[0].systemPrompt).toBe(
      "$file:test-prompt.md",
    );
  });
});

describe("Default Config", () => {
  it("is valid according to schema", () => {
    const result = tickleStickConfigSchema.parse(DEFAULT_CONFIG);
    expect(result).toBeDefined();
  });

  it("has empty pipelines by default", () => {
    expect(Object.keys(DEFAULT_CONFIG.tickleStick.pipelines)).toHaveLength(0);
  });

  it("has telemetry enabled", () => {
    expect(DEFAULT_CONFIG.tickleStick.telemetry.enabled).toBe(true);
  });
});

describe("StageConfig.input filter validation", () => {
  function buildWithInput(input: string) {
    return {
      tickleStick: {
        pipelines: {
          test: {
            stages: [
              {
                name: "filter",
                type: "callback" as const,
                input,
              },
            ],
          },
        },
      },
    };
  }

  it("accepts 'all'", () => {
    expect(() =>
      tickleStickConfigSchema.parse(buildWithInput("all")),
    ).not.toThrow();
  });

  it.each([
    "classified:routine",
    "classified:urgent",
    "classified:needs-reasoning",
    "classified:needs-reasoning,classified:urgent",
    "classified:routine, classified:urgent",
  ])("accepts valid filter %s", (input) => {
    expect(() =>
      tickleStickConfigSchema.parse(buildWithInput(input)),
    ).not.toThrow();
  });

  it.each([
    "garbage",
    "classified:bogus",
    "tier:1",
    "classified:routine,bogus",
    "",
  ])("rejects invalid filter %s", (input) => {
    expect(() =>
      tickleStickConfigSchema.parse(buildWithInput(input)),
    ).toThrow();
  });
});
