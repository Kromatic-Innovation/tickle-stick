import type { TickleStickConfig } from "./schema.js";

export const DEFAULT_CONFIG: TickleStickConfig = {
  tickleStick: {
    pipelines: {},
    telemetry: {
      enabled: true,
      format: "json" as const,
    },
  },
};
