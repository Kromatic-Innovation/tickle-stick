import { z } from "zod";

const tier0Schema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  timeout: z.number().positive().default(30000),
  cwd: z.string().optional(),
});

const tier1Schema = z.object({
  systemPrompt: z.string(),
  confidenceThreshold: z.number().min(0).max(1).default(0.7),
});

const tier2Schema = z.object({
  prompt: z.string(),
});

const tier3Schema = z.object({
  route: z.string(),
});

const pipelineSchema = z.object({
  tier0: tier0Schema,
  tier1: tier1Schema.optional(),
  tier2: tier2Schema.optional(),
  tier3: tier3Schema.optional(),
});

const telemetrySchema = z.object({
  enabled: z.boolean().default(true),
  format: z.enum(["json", "text"]).default("json"),
});

const budgetAlertSchema = z.object({
  at: z.union([z.string(), z.number()]),
});

const budgetSchema = z.object({
  maxDailySpend: z.number().positive().optional(),
  maxWeeklySpend: z.number().positive().optional(),
  alerts: z.array(budgetAlertSchema).default([]),
  retentionDays: z.number().positive().default(30),
});

export const tickleStickConfigSchema = z.object({
  tickleStick: z.object({
    pipelines: z.record(z.string(), pipelineSchema).default({}),
    telemetry: telemetrySchema.default({ enabled: true, format: "json" }),
    budget: budgetSchema.optional(),
  }),
});

export type TickleStickConfig = z.infer<typeof tickleStickConfigSchema>;
export type PipelineConfigEntry = z.infer<typeof pipelineSchema>;
export type Tier0Config = z.infer<typeof tier0Schema>;
export type Tier1Config = z.infer<typeof tier1Schema>;
export type Tier2Config = z.infer<typeof tier2Schema>;
export type Tier3Config = z.infer<typeof tier3Schema>;
export type TelemetryConfig = z.infer<typeof telemetrySchema>;
export type BudgetConfig = z.infer<typeof budgetSchema>;
export type BudgetAlertConfig = z.infer<typeof budgetAlertSchema>;
