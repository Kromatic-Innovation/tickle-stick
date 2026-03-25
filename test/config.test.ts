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

  it("validates a config with pipelines", () => {
    const result = tickleStickConfigSchema.parse({
      tickleStick: {
        pipelines: {
          "daily-briefing": {
            tier0: {
              command: "python3",
              args: ["scripts/fetch-daily.py"],
              timeout: 30000,
            },
            tier1: {
              systemPrompt: "Classify this.",
              confidenceThreshold: 0.8,
            },
            tier2: {
              prompt: "Synthesize: {{items}}",
            },
            tier3: {
              route: "main",
            },
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
    expect(pipeline.tier1!.confidenceThreshold).toBe(0.8);
    expect(pipeline.tier0.command).toBe("python3");
    expect(pipeline.tier2!.prompt).toContain("{{items}}");
    expect(result.tickleStick.budget!.maxDailySpend).toBe(1.0);
  });

  it("applies defaults for optional fields", () => {
    const result = tickleStickConfigSchema.parse({
      tickleStick: {
        pipelines: {
          test: {
            tier0: { command: "echo", args: ["[]"] },
            tier1: { systemPrompt: "Test" },
          },
        },
      },
    });

    const pipeline = result.tickleStick.pipelines["test"];
    expect(pipeline.tier1!.confidenceThreshold).toBe(0.7);
    expect(pipeline.tier0.timeout).toBe(30000);
    expect(result.tickleStick.telemetry.format).toBe("json");
  });

  it("rejects invalid confidence threshold", () => {
    expect(() =>
      tickleStickConfigSchema.parse({
        tickleStick: {
          pipelines: {
            test: {
              tier0: { command: "echo" },
              tier1: {
                systemPrompt: "test",
                confidenceThreshold: 1.5,
              },
            },
          },
        },
      }),
    ).toThrow();
  });

  it("requires tier0 command in pipeline", () => {
    expect(() =>
      tickleStickConfigSchema.parse({
        tickleStick: {
          pipelines: {
            test: {
              tier0: {},
            },
          },
        },
      }),
    ).toThrow();
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

  it("parses YAML string with pipeline config", () => {
    const yaml = `
tickleStick:
  pipelines:
    email-check:
      tier0:
        command: "python3"
        args: ["check-email.py"]
`;
    const config = loadConfigFromString(yaml);
    const pipeline = config.tickleStick.pipelines["email-check"];
    expect(pipeline.tier0.command).toBe("python3");
    expect(pipeline.tier0.args).toEqual(["check-email.py"]);
  });

  it("interpolates environment variables", () => {
    process.env.SCRIPT_PATH = "custom/script.py";

    const yaml = `
tickleStick:
  pipelines:
    test:
      tier0:
        command: "python3"
        args: ["\${SCRIPT_PATH}"]
`;
    const config = loadConfigFromString(yaml);
    expect(config.tickleStick.pipelines["test"].tier0.args[0]).toBe(
      "custom/script.py",
    );
  });

  it("replaces missing env vars with empty string", () => {
    delete process.env.NONEXISTENT_VAR;

    const yaml = `
tickleStick:
  pipelines:
    test:
      tier0:
        command: "\${NONEXISTENT_VAR}"
`;
    // empty string command will still parse (schema allows any string)
    const config = loadConfigFromString(yaml);
    expect(config.tickleStick.pipelines["test"].tier0.command).toBe("");
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
