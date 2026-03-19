import type { TickleStickConfig } from "./schema.js";

export const DEFAULT_CONFIG: TickleStickConfig = {
  tickleStick: {
    tier0: {
      patterns: [
        {
          match: "^(hi|hello|hey|howdy)\\b",
          type: "regex" as const,
          flags: "i",
          action: "deflect" as const,
          response: "Hello! How can I help you today?",
        },
        {
          match: "/help",
          type: "command" as const,
          action: "deflect" as const,
          response:
            "Available commands: /help, /status, /escalate\n\nFor complex questions, just ask — your message will be routed to the right place.",
        },
      ],
      keywords: [
        {
          match: ["unsubscribe", "stop emails", "remove me"],
          action: "deflect" as const,
          response:
            "Your request has been noted. You will be removed from future communications.",
        },
      ],
    },
    tier1: undefined,
    telemetry: {
      enabled: true,
      format: "json" as const,
      includeMessagePreview: false,
    },
  },
};
