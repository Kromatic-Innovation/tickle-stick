import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfigFromString } from "../src/config/loader.js";
import { tickleStickConfigSchema } from "../src/config/schema.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";

describe("Config Schema", () => {
  it("validates a minimal config", () => {
    const result = tickleStickConfigSchema.parse({
      tickleStick: {},
    });

    expect(result.tickleStick.tier0.patterns).toEqual([]);
    expect(result.tickleStick.tier1).toBeUndefined();
    expect(result.tickleStick.telemetry.enabled).toBe(true);
  });

  it("validates a full config", () => {
    const result = tickleStickConfigSchema.parse({
      tickleStick: {
        tier0: {
          patterns: [
            {
              match: "^hello$",
              type: "regex",
              flags: "i",
              action: "deflect",
              response: "Hi!",
            },
          ],
          keywords: [
            {
              match: ["test"],
              action: "deflect",
              response: "Test response",
            },
          ],
        },
        tier1: {
          systemPrompt: "Classify this.",
          confidenceThreshold: 0.8,
          timeout: 3000,
        },
        telemetry: {
          enabled: true,
          format: "json",
          includeMessagePreview: true,
        },
      },
    });

    expect(result.tickleStick.tier1!.confidenceThreshold).toBe(0.8);
  });

  it("applies defaults for optional fields", () => {
    const result = tickleStickConfigSchema.parse({
      tickleStick: {
        tier1: {
          systemPrompt: "Test",
        },
      },
    });

    expect(result.tickleStick.tier1!.confidenceThreshold).toBe(0.7);
    expect(result.tickleStick.tier1!.timeout).toBe(5000);
    expect(result.tickleStick.telemetry.format).toBe("json");
  });

  it("rejects invalid action in pattern", () => {
    expect(() =>
      tickleStickConfigSchema.parse({
        tickleStick: {
          tier0: {
            patterns: [
              {
                match: "test",
                type: "regex",
                action: "escalate", // Only "deflect" is valid for tier0
                response: "test",
              },
            ],
          },
        },
      }),
    ).toThrow();
  });

  it("rejects invalid confidence threshold", () => {
    expect(() =>
      tickleStickConfigSchema.parse({
        tickleStick: {
          tier1: {
            systemPrompt: "test",
            confidenceThreshold: 1.5, // Must be 0-1
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

  it("parses YAML string", () => {
    const yaml = `
tickleStick:
  tier0:
    patterns:
      - match: "^hi$"
        type: regex
        action: deflect
        response: "Hello!"
`;
    const config = loadConfigFromString(yaml);
    expect(config.tickleStick.tier0.patterns).toHaveLength(1);
  });

  it("interpolates environment variables", () => {
    process.env.TEST_GREETING = "Welcome aboard!";

    const yaml = `
tickleStick:
  tier0:
    patterns:
      - match: "^hi$"
        type: regex
        action: deflect
        response: "\${TEST_GREETING}"
`;
    const config = loadConfigFromString(yaml);
    expect(config.tickleStick.tier0.patterns[0].response).toBe(
      "Welcome aboard!",
    );
  });

  it("replaces missing env vars with empty string", () => {
    delete process.env.NONEXISTENT_VAR;

    const yaml = `
tickleStick:
  tier0:
    patterns:
      - match: "^test$"
        type: regex
        action: deflect
        response: "\${NONEXISTENT_VAR}"
`;
    const config = loadConfigFromString(yaml);
    expect(config.tickleStick.tier0.patterns[0].response).toBe("");
  });
});

describe("Default Config", () => {
  it("is valid according to schema", () => {
    const result = tickleStickConfigSchema.parse(DEFAULT_CONFIG);
    expect(result).toBeDefined();
  });

  it("has Tier 0 patterns", () => {
    expect(DEFAULT_CONFIG.tickleStick.tier0.patterns.length).toBeGreaterThan(0);
  });

  it("has telemetry enabled", () => {
    expect(DEFAULT_CONFIG.tickleStick.telemetry.enabled).toBe(true);
  });
});
