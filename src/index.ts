export { Interceptor, type InterceptorOptions } from "./interceptor.js";
export { loadConfig, loadConfigFromString } from "./config/loader.js";
export { DEFAULT_CONFIG } from "./config/defaults.js";
export { tickleStickConfigSchema } from "./config/schema.js";
export type {
  TickleStickConfig,
  Tier0Config,
  Tier1Config,
  TelemetryConfig,
  PatternRule,
  KeywordGroup,
} from "./config/schema.js";
export type {
  InboundMessage,
  TierResult,
  TierAction,
  TriageDecision,
  TriageProvider,
} from "./types.js";
export { parseTriageResponse } from "./providers/parse.js";
export { MetricsCollector, type TierMetrics } from "./telemetry/metrics.js";
export {
  createLogger,
  buildTelemetryEvent,
  type TelemetryEvent,
  type LogSink,
} from "./telemetry/logger.js";
