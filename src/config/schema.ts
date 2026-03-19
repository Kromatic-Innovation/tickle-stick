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
  provider: z.string(),
  model: z.string(),
  systemPrompt: z.string(),
  confidenceThreshold: z.number().min(0).max(1).default(0.7),
  timeout: z.number().positive().default(5000),
});

const escalationRouteSchema = z.object({
  channel: z.enum(["webhook", "email", "slack"]),
  url: z.string().optional(),
  to: z.string().optional(),
  webhookUrl: z.string().optional(),
});

const tier3Schema = z.object({
  routes: z.array(escalationRouteSchema).default([]),
});

const telemetrySchema = z.object({
  enabled: z.boolean().default(true),
  format: z.enum(["json", "text"]).default("json"),
  includeMessagePreview: z.boolean().default(false),
});

const providerConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});

const providersSchema = z
  .object({
    anthropic: providerConfigSchema.optional(),
    openai: providerConfigSchema.optional(),
    ollama: z
      .object({
        baseUrl: z.string().default("http://localhost:11434"),
      })
      .optional(),
  })
  .default({});

export const tickleStickConfigSchema = z.object({
  tickleStick: z.object({
    tier0: tier0Schema.default({ patterns: [], keywords: [] }),
    tier1: tier1Schema.optional(),
    tier3: tier3Schema.default({ routes: [] }),
    telemetry: telemetrySchema.default({}),
    providers: providersSchema,
  }),
});

export type TickleStickConfig = z.infer<typeof tickleStickConfigSchema>;
export type Tier0Config = z.infer<typeof tier0Schema>;
export type Tier1Config = z.infer<typeof tier1Schema>;
export type Tier3Config = z.infer<typeof tier3Schema>;
export type TelemetryConfig = z.infer<typeof telemetrySchema>;
export type PatternRule = z.infer<typeof patternRuleSchema>;
export type KeywordGroup = z.infer<typeof keywordGroupSchema>;
export type EscalationRoute = z.infer<typeof escalationRouteSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
