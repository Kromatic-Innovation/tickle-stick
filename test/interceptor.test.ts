import { describe, it, expect, vi } from "vitest";
import { Interceptor } from "../src/interceptor.js";
import type { TickleStickConfig } from "../src/config/schema.js";
import type { InboundMessage } from "../src/types.js";

function makeMessage(
  body: string,
  overrides?: Partial<InboundMessage>,
): InboundMessage {
  return {
    id: "test-msg",
    channel: "email",
    from: "test@example.com",
    body,
    timestamp: new Date(),
    ...overrides,
  };
}

const baseConfig: TickleStickConfig = {
  tickleStick: {
    tier0: {
      patterns: [
        {
          match: "^(hi|hello|hey)$",
          type: "regex",
          flags: "i",
          action: "deflect",
          response: "Hello!",
        },
      ],
      keywords: [],
    },
    tier1: undefined,
    tier3: { routes: [] },
    telemetry: { enabled: false, format: "json", includeMessagePreview: false },
    providers: {},
  },
};

describe("Interceptor", () => {
  it("routes matching messages to Tier 0", async () => {
    const interceptor = new Interceptor({ config: baseConfig });
    const result = await interceptor.process(makeMessage("Hello"));

    expect(result.tier).toBe(0);
    expect(result.action).toBe("deflect");
    expect(result.response).toBe("Hello!");
  });

  it("falls through to Tier 2 when no Tier 0 match and no Tier 1 config", async () => {
    const interceptor = new Interceptor({ config: baseConfig });
    const result = await interceptor.process(
      makeMessage("Tell me about your API pricing"),
    );

    expect(result.tier).toBe(2);
    expect(result.action).toBe("passthrough");
  });

  it("emits telemetry when enabled", async () => {
    const logSink = vi.fn();
    const config: TickleStickConfig = {
      ...baseConfig,
      tickleStick: {
        ...baseConfig.tickleStick,
        telemetry: {
          enabled: true,
          format: "json",
          includeMessagePreview: false,
        },
      },
    };

    const interceptor = new Interceptor({ config, logSink });
    await interceptor.process(makeMessage("Hello"));

    expect(logSink).toHaveBeenCalledOnce();
    expect(logSink).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tickle_stick.process",
        tier: 0,
        action: "deflect",
      }),
    );
  });

  it("does not emit telemetry when disabled", async () => {
    const logSink = vi.fn();
    const interceptor = new Interceptor({ config: baseConfig, logSink });
    await interceptor.process(makeMessage("Hello"));

    expect(logSink).not.toHaveBeenCalled();
  });

  it("tracks metrics across multiple messages", async () => {
    const interceptor = new Interceptor({ config: baseConfig });

    await interceptor.process(makeMessage("Hello"));
    await interceptor.process(makeMessage("Hey"));
    await interceptor.process(
      makeMessage("Complex question about architecture"),
    );

    const metrics = interceptor.getMetrics();
    expect(metrics.totalProcessed).toBe(3);
    expect(metrics.tierDistribution[0]).toBe(2);
    expect(metrics.tierDistribution[2]).toBe(1);
    expect(metrics.costSaved).toBeGreaterThan(0);
  });

  it("resets metrics", async () => {
    const interceptor = new Interceptor({ config: baseConfig });
    await interceptor.process(makeMessage("Hello"));

    interceptor.resetMetrics();
    const metrics = interceptor.getMetrics();
    expect(metrics.totalProcessed).toBe(0);
  });
});
