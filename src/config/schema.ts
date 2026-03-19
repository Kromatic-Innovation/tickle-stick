import { z } from "zod";

const patternRuleSchema = z.object({
  match: z.string(),
  type: z.enum(["regex", "keyword", "command"]),
  flags: z.string().optional(),
  action: z.literal("deflect"),
  response: z.string(),
});

const keywordGroupSchema = z.object({
  match: z.array(z.string()),
  action: z.literal("deflect"),
  response: z.string(),
});

const tier0Schema = z.object({
  patterns: z.array(patternRuleSchema).default([]),
  keywords: z.array(keywordGroupSchema).default([]),
});

const tier1Schema = z.object({
  systemPrompt: z.string(),
  confidenceThreshold: z.number().min(0).max(1).default(0.7),
  timeout: z.number().positive().default(5000),
});

const telemetrySchema = z.object({
  enabled: z.boolean().default(true),
  format: z.enum(["json", "text"]).default("json"),
  includeMessagePreview: z.boolean().default(false),
});

export const tickleStickConfigSchema = z.object({
  tickleStick: z.object({
    tier0: tier0Schema.default({ patterns: [], keywords: [] }),
    tier1: tier1Schema.optional(),
    telemetry: telemetrySchema.default({}),
  }),
});

export type TickleStickConfig = z.infer<typeof tickleStickConfigSchema>;
export type Tier0Config = z.infer<typeof tier0Schema>;
export type Tier1Config = z.infer<typeof tier1Schema>;
export type TelemetryConfig = z.infer<typeof telemetrySchema>;
export type PatternRule = z.infer<typeof patternRuleSchema>;
export type KeywordGroup = z.infer<typeof keywordGroupSchema>;
