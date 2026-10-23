import { z } from "zod";
import { CLASSIFICATIONS } from "../types.js";

const inputFilterSchema = z.string().refine(
  (s) => {
    if (s === "all") return true;
    const tokens = s
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (tokens.length === 0) return false;
    return tokens.every((t) => {
      if (!t.startsWith("classified:")) return false;
      const value = t.slice("classified:".length);
      return (CLASSIFICATIONS as readonly string[]).includes(value);
    });
  },
  {
    message: `StageConfig.input must be "all" or a comma-separated list of "classified:<value>" tokens (values: ${CLASSIFICATIONS.join("|")})`,
  },
);

const postHookSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  timeout: z.number().positive().default(15000),
});

const stageSchema = z
  .object({
    name: z.string(),
    type: z.enum(["script", "model", "callback"]),
    // script fields
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    timeout: z.number().positive().default(30000),
    cwd: z.string().optional(),
    // model fields
    provider: z.enum(["cheap", "expensive"]).optional(),
    systemPrompt: z.string().optional(),
    prompt: z.string().optional(),
    confidenceThreshold: z.number().min(0).max(1).optional(),
    // pricing — defaults match Haiku 3.5 / 4o-mini input/output rates
    costPerInputToken: z.number().nonnegative().optional(),
    costPerOutputToken: z.number().nonnegative().optional(),
    /** Cost charged per classification when the provider does not return tokenUsage. */
    defaultCostEstimate: z.number().nonnegative().optional(),
    // filtering
    input: inputFilterSchema.optional(),
    // post-hook
    postHook: postHookSchema.optional(),
  })
  // Unknown keys (e.g. a misspelled `systemprompt` or `confidenceThreshhold`)
  // must be rejected at load time rather than silently stripped — a typo'd
  // key previously disabled a stage with no error (tickle-stick#243).
  .strict()
  .superRefine((stage, ctx) => {
    // `=== undefined` (not falsy) deliberately: an env-var interpolation
    // that resolves to an empty string is a separate, already-warned-on
    // misconfiguration (loader.ts `interpolateEnvVars`), not a missing key.
    if (stage.type === "script" && stage.command === undefined) {
      ctx.addIssue({
        code: "custom",
        message: `Stage "${stage.name}": type "script" requires a "command"`,
        path: ["command"],
      });
    }
    if (
      stage.type === "model" &&
      stage.provider === "cheap" &&
      stage.systemPrompt === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: `Stage "${stage.name}": type "model" with provider "cheap" requires a "systemPrompt"`,
        path: ["systemPrompt"],
      });
    }
  });

export const scheduleSchema = z
  .object({
    type: z.enum(["cron", "interval", "once"]),
    value: z.string(),
    name: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const pipelineSchema = z
  .object({
    stages: z.array(stageSchema).min(1),
    schedule: scheduleSchema.optional(),
    schedules: z.array(scheduleSchema).optional(),
  })
  .passthrough();

const telemetrySchema = z.object({
  enabled: z.boolean().default(true),
  format: z.enum(["json", "text"]).default("json"),
});

// A bare number, a percentage string ("80%"), or a plain decimal amount
// string ("0.5"). Anything else (e.g. "eighty%") previously parsed to NaN
// at runtime and silently never fired (tickle-stick#243).
const alertAtStringSchema = z.string().regex(/^\d+(\.\d+)?%?$/, {
  message:
    'BudgetAlertConfig.at string must be a percentage (e.g. "80%") or a plain decimal amount (e.g. "0.5")',
});

const budgetAlertSchema = z.object({
  at: z.union([z.number(), alertAtStringSchema]),
});

const budgetSchema = z.object({
  maxDailySpend: z.number().positive().optional(),
  maxWeeklySpend: z.number().positive().optional(),
  alerts: z.array(budgetAlertSchema).default([]),
  retentionDays: z.number().positive().default(30),
});

export const tickleStickConfigSchema = z.object({
  tickleStick: z
    .object({
      pipelines: z.record(z.string(), pipelineSchema).default({}),
      telemetry: telemetrySchema.default({ enabled: true, format: "json" }),
      budget: budgetSchema.optional(),
    })
    .passthrough(),
});

export type TickleStickConfig = z.infer<typeof tickleStickConfigSchema>;
export type PipelineConfigEntry = z.infer<typeof pipelineSchema>;
export type StageConfig = z.infer<typeof stageSchema>;
export type PostHookConfig = z.infer<typeof postHookSchema>;
export type TelemetryConfig = z.infer<typeof telemetrySchema>;
export type BudgetConfig = z.infer<typeof budgetSchema>;
export type BudgetAlertConfig = z.infer<typeof budgetAlertSchema>;
export type ScheduleConfig = z.infer<typeof scheduleSchema>;
